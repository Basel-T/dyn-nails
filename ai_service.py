import base64
import os
from datetime import datetime
from uuid import uuid4

from openai import OpenAI
from openai import APIError, BadRequestError, NotFoundError, PermissionDeniedError, RateLimitError
from PIL import Image, ImageOps


# The GPT image edit endpoint can handle larger files, but resizing huge phone
# photos keeps the demo faster, cheaper, and less likely to hit upload limits.
MAX_IMAGE_SIDE = 1536

# Generated previews are saved here so Flask can show and download them.
RESULTS_FOLDER = os.path.join("static", "results")

# Temporary resized copies are saved here before being sent to OpenAI.
# The original upload is still kept unchanged for display on the result page.
UPLOADS_FOLDER = os.path.join("static", "uploads")

# User-painted masks are stored here. Prepared API masks also live here.
MASKS_FOLDER = os.path.join("static", "masks")

# API errors are written here because the Flask server may be running in a
# hidden window, which makes terminal prints hard to see.
LOGS_FOLDER = "logs"
ERROR_LOG_PATH = os.path.join(LOGS_FOLDER, "openai_errors.log")

# Defaults are intentionally low-cost for the MVP.
DEFAULT_IMAGE_MODEL = "gpt-image-2"
DEFAULT_IMAGE_QUALITY = "low"


class MissingAPIKeyError(Exception):
    """Raised when the app cannot find OPENAI_API_KEY."""


class AIGenerationError(Exception):
    """Raised when OpenAI image generation fails."""


# Each preset has a focused description.
# The shared prompt below will add the important "only change nails" rules.
STYLE_PROMPTS = {
    "Classic French": (
        "Create a classic French manicure with a natural sheer pink nail bed "
        "and clean soft-white tips. The nails should look elegant, timeless, "
        "and professionally shaped."
    ),
    "Nude Glossy": (
        "Create a nude glossy manicure with a flattering beige-pink nude tone "
        "and a smooth high-shine salon gel finish."
    ),
    "Red Almond": (
        "Create a rich red almond manicure. The nails should have a refined "
        "almond shape, a deep classic red color, and a glossy salon finish."
    ),
    "Pink Chrome": (
        "Create a pink chrome manicure with a soft rosy base and reflective "
        "chrome shine. The effect should look polished, modern, and realistic."
    ),
    "Milky White": (
        "Create a milky white manicure with a semi-sheer creamy white finish. "
        "The nails should look soft, clean, and glossy."
    ),
    "Black Glossy": (
        "Create a black glossy manicure with a smooth deep black color and a "
        "high-shine gel finish. Keep the style sleek and elegant."
    ),
    "Glitter Accent": (
        "Create a manicure with a neutral glossy base and tasteful glitter "
        "accent nails. The glitter should look like real salon nail glitter, "
        "not flat paint or stickers."
    ),
    "Baby Boomer Ombre": (
        "Create a baby boomer ombre manicure with a soft gradient from natural "
        "pink near the cuticle to milky white at the tips. The blend should be "
        "smooth, subtle, and salon-realistic."
    ),
}


def get_image_settings():
    """Read image model settings from the environment with simple defaults."""
    model = os.getenv("OPENAI_IMAGE_MODEL", DEFAULT_IMAGE_MODEL).strip()
    quality = os.getenv("OPENAI_IMAGE_QUALITY", DEFAULT_IMAGE_QUALITY).strip()

    # Keep quality conservative. If someone types an unsupported value in .env,
    # fall back to low instead of sending a request that will fail.
    if quality not in {"low", "medium", "high", "auto"}:
        quality = DEFAULT_IMAGE_QUALITY

    return model, quality


def log_openai_error(title, error):
    """Write the real OpenAI error to a local log file for debugging."""
    os.makedirs(LOGS_FOLDER, exist_ok=True)

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with open(ERROR_LOG_PATH, "a", encoding="utf-8") as log_file:
        log_file.write(f"\n[{timestamp}] {title}\n")
        log_file.write(f"{repr(error)}\n")


def build_prompt(selected_style, selected_shape="oval", selected_length="medium"):
    """Build the full image-editing prompt for the selected nail style."""
    style_details = STYLE_PROMPTS[selected_style]

    return f"""
Edit this photo to preview a professional manicure on the same hand.

Selected nail style:
{style_details}

Desired nail shape and length:
- Shape: {selected_shape}
- Length: {selected_length}

Critical editing rules:
- Preserve the original hand, pose, skin tone, lighting, jewelry, tattoos, background, and photo composition.
- The mask defines the desired final nail or extension shape and length.
- Apply the chosen nail style inside the masked nail areas only.
- Blend naturally with the original nail beds.
- Keep everything outside the mask unchanged.
- Make the result photorealistic and salon-quality.
- Do not change finger shape, hand anatomy, rings, skin texture, tattoos, sleeves, objects, or background.
- Keep the edit realistic, not cartoonish, painted-on, plastic, or sticker-like.
- Keep the original camera angle, shadows, reflections, and overall image quality.
- Do not add text, logos, labels, watermarks, or extra objects.
""".strip()


def model_fallback_message():
    """Friendly message when the configured model is unavailable."""
    return (
        "The selected OpenAI image model is unavailable for this account. "
        "Try OPENAI_IMAGE_MODEL=gpt-image-1.5 or OPENAI_IMAGE_MODEL=gpt-image-1-mini in your .env file."
    )


def looks_like_model_access_error(error):
    """Return True when an API error appears to be model access/config related."""
    message = str(error).lower()
    model, _quality = get_image_settings()

    if model.lower() in message:
        return True

    return any(
        phrase in message
        for phrase in [
            "model does not exist",
            "model not found",
            "model is not available",
            "model_not_found",
            "do not have access to model",
            "does not have access to model",
            "unsupported model",
        ]
    )


def mask_has_edit_area(mask_path):
    """Return True when a mask has transparent pixels or white guide pixels."""
    with Image.open(mask_path) as mask:
        mask = mask.convert("RGBA")
        alpha = mask.getchannel("A")
        if alpha.getextrema()[0] < 255:
            return True

        grayscale = mask.convert("L")
        return grayscale.getextrema()[1] > 200


def prepare_image_and_mask_for_openai(original_image_path, original_mask_path):
    """Create resized image and mask files with exactly matching dimensions."""
    os.makedirs(UPLOADS_FOLDER, exist_ok=True)
    os.makedirs(MASKS_FOLDER, exist_ok=True)

    with Image.open(original_image_path) as image:
        # Respect phone camera rotation metadata before resizing.
        image = ImageOps.exif_transpose(image)
        original_size = image.size

        with Image.open(original_mask_path) as mask:
            mask = mask.convert("RGBA")

            # Browser canvas dimensions normally match the displayed image.
            # If phone EXIF rotation makes the raw dimensions differ, resize the
            # mask to the corrected image dimensions before the shared thumbnail.
            if mask.size != original_size:
                mask = mask.resize(original_size, Image.Resampling.NEAREST)

            # Resize both image and mask with the same scale.
            image.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
            prepared_size = image.size
            if mask.size != prepared_size:
                mask = mask.resize(prepared_size, Image.Resampling.LANCZOS)

            # The browser guide editor exports white editable shapes on black.
            # OpenAI image edits use transparent pixels as the editable area, so
            # white guide pixels become transparent and dark pixels stay opaque.
            alpha = mask.getchannel("A")
            if alpha.getextrema()[0] < 255:
                alpha = alpha.point(lambda value: 0 if value < 128 else 255)
            else:
                grayscale = mask.convert("L")
                alpha = grayscale.point(lambda value: 0 if value > 200 else 255)
            prepared_mask = Image.new("RGBA", prepared_size, (0, 0, 0, 255))
            prepared_mask.putalpha(alpha)

        # JPEG does not support transparency, so place transparent images on white.
        if image.mode in ("RGBA", "LA"):
            background = Image.new("RGB", image.size, (255, 255, 255))
            background.paste(image, mask=image.getchannel("A"))
            image = background
        else:
            image = image.convert("RGB")

        prepared_filename = f"openai_input_{uuid4().hex}.jpg"
        prepared_path = os.path.join(UPLOADS_FOLDER, prepared_filename)

        # Quality 92 keeps enough detail for a realistic preview without making
        # the file unnecessarily huge.
        image.save(prepared_path, format="JPEG", quality=92, optimize=True)

        prepared_mask_filename = f"openai_mask_{uuid4().hex}.png"
        prepared_mask_path = os.path.join(MASKS_FOLDER, prepared_mask_filename)
        prepared_mask.save(prepared_mask_path, format="PNG", optimize=True)

    return prepared_path, prepared_mask_path


def generate_nail_preview(
    uploaded_image_path,
    mask_path,
    selected_style,
    selected_shape="oval",
    selected_length="medium",
):
    """Send the uploaded hand photo to OpenAI and save the generated result."""
    if selected_style not in STYLE_PROMPTS:
        raise AIGenerationError("Unknown nail style selected.")

    if not mask_has_edit_area(mask_path):
        raise AIGenerationError("Please add at least one nail guide before generating.")

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise MissingAPIKeyError(
            "OPENAI_API_KEY is missing. Add it to your .env file and restart Flask."
        )

    os.makedirs(RESULTS_FOLDER, exist_ok=True)

    client = OpenAI(api_key=api_key)
    prompt = build_prompt(selected_style, selected_shape, selected_length)
    model, quality = get_image_settings()
    prepared_image_path, prepared_mask_path = prepare_image_and_mask_for_openai(
        uploaded_image_path,
        mask_path,
    )
    result_filename = f"nail_preview_{uuid4().hex}.png"
    result_path = os.path.join(RESULTS_FOLDER, result_filename)

    try:
        with open(prepared_image_path, "rb") as image_file, open(prepared_mask_path, "rb") as mask_file:
            # GPT image models return base64 image data by default.
            result = client.images.edit(
                model=model,
                image=image_file,
                mask=mask_file,
                prompt=prompt,
                size="auto",
                quality=quality,
                output_format="png",
                n=1,
            )

        image_base64 = result.data[0].b64_json
        image_bytes = base64.b64decode(image_base64)

        with open(result_path, "wb") as output_file:
            output_file.write(image_bytes)

        return result_path

    except BadRequestError as error:
        # BadRequestError usually means one of the API parameters or the image
        # format/size was rejected.
        print("OpenAI rejected the image edit request:", error)
        log_openai_error("OpenAI rejected the image edit request", error)

        if looks_like_model_access_error(error):
            raise AIGenerationError(model_fallback_message()) from error

        raise AIGenerationError(
            "The AI could not edit this image. Please try a clearer JPG or PNG hand photo."
        ) from error

    except (NotFoundError, PermissionDeniedError) as error:
        print("OpenAI model access error:", error)
        log_openai_error("OpenAI model access error", error)
        raise AIGenerationError(model_fallback_message()) from error

    except RateLimitError as error:
        # This can happen if the account has no credits, has hit a rate limit,
        # or the model is not available for the current usage tier.
        print("OpenAI rate limit or billing error:", error)
        log_openai_error("OpenAI rate limit or billing error", error)
        raise AIGenerationError(
            "The AI service is temporarily unavailable or the account needs billing/usage access."
        ) from error

    except APIError as error:
        print("OpenAI API error:", error)
        log_openai_error("OpenAI API error", error)
        raise AIGenerationError(
            "The AI service had a temporary problem. Please try again in a moment."
        ) from error

    except Exception as error:
        # The user sees a friendly message, while the terminal gets the useful
        # debugging details.
        print("OpenAI image generation failed:", repr(error))
        log_openai_error("OpenAI image generation failed", error)
        raise AIGenerationError(
            "Sorry, the AI preview could not be generated right now. Please try again."
        ) from error
