import base64
import io
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


def prepare_base64_image_and_mask(hand_b64: str, mask_b64: str):
    """
    Accept raw base64 strings for the hand photo and mask,
    resize/normalize them, and return ready-to-use file-like objects
    along with the prepared mask for OpenAI.
    Returns (image_bytes_io, mask_bytes_io)
    """
    # Decode base64 → PIL Image
    hand_bytes = base64.b64decode(hand_b64)
    mask_bytes = base64.b64decode(mask_b64)

    with Image.open(io.BytesIO(hand_bytes)) as image:
        image = ImageOps.exif_transpose(image)
        original_size = image.size

        with Image.open(io.BytesIO(mask_bytes)) as mask:
            mask = mask.convert("RGBA")

            if mask.size != original_size:
                mask = mask.resize(original_size, Image.Resampling.NEAREST)

            # Resize both to fit within MAX_IMAGE_SIDE
            image.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
            prepared_size = image.size
            if mask.size != prepared_size:
                mask = mask.resize(prepared_size, Image.Resampling.LANCZOS)

            # Convert mask: white pixels (nail areas) → transparent (OpenAI editable area)
            grayscale = mask.convert("L")
            alpha = grayscale.point(lambda v: 0 if v > 200 else 255)
            prepared_mask = Image.new("RGBA", prepared_size, (0, 0, 0, 255))
            prepared_mask.putalpha(alpha)

        # Ensure image is RGB JPEG
        if image.mode in ("RGBA", "LA"):
            bg = Image.new("RGB", image.size, (255, 255, 255))
            bg.paste(image, mask=image.getchannel("A"))
            image = bg
        else:
            image = image.convert("RGB")

        img_io = io.BytesIO()
        image.save(img_io, format="JPEG", quality=92, optimize=True)
        img_io.seek(0)
        img_io.name = "hand.jpg"

        mask_io = io.BytesIO()
        prepared_mask.save(mask_io, format="PNG", optimize=True)
        mask_io.seek(0)
        mask_io.name = "mask.png"

    return img_io, mask_io


LENGTH_MULTS = {"short": 0.70, "medium": 1.0, "long": 1.35}


def composite_nail_designs(
    hand_b64: str,
    nail_positions: list,
    design_images: list,
    shape: str,
    length_mult: float,
    size_mult: float,
) -> Image.Image:
    """
    Project each drawn nail-canvas design onto the hand photo at the correct
    position, size and rotation.  Returns a PIL Image (RGB) — the draft that
    OpenAI will use as source context.

    nail_positions: [{finger, centerX, centerY, widthNorm, heightNorm, rotationDeg}, …]
    design_images:  [{finger, dataUrl: 'data:image/png;base64,…'}, …]
    """
    hand_bytes = base64.b64decode(hand_b64)
    with Image.open(io.BytesIO(hand_bytes)) as hand_img:
        hand_img = ImageOps.exif_transpose(hand_img).convert("RGBA")
        W, H = hand_img.size

        # Build lookup: finger → PIL Image
        design_lookup: dict[str, Image.Image] = {}
        for d in design_images:
            finger   = d.get("finger", "")
            data_url = d.get("dataUrl", "")
            if not data_url:
                continue
            b64_part = data_url.split(",", 1)[1] if "," in data_url else data_url
            img_bytes = base64.b64decode(b64_part)
            design_lookup[finger] = Image.open(io.BytesIO(img_bytes)).convert("RGBA")

        for nail in nail_positions:
            finger = nail.get("finger", "")
            design = design_lookup.get(finger)
            if design is None:
                continue

            cx    = nail["centerX"]    * W
            cy    = nail["centerY"]    * H
            nailW = max(1, int(nail["widthNorm"]  * W * size_mult))
            nailH = max(1, int(nail["heightNorm"] * H * length_mult * size_mult))
            rot   = nail["rotationDeg"]

            # Scale to the nail dimensions in photo-pixel space
            nail_resized  = design.resize((nailW, nailH), Image.LANCZOS)
            # PIL rotates counter-clockwise; our rotationDeg is clockwise
            nail_rotated  = nail_resized.rotate(-rot, expand=True, resample=Image.BICUBIC)

            # Paste centred on (cx, cy)
            px = int(cx - nail_rotated.width  / 2)
            py = int(cy - nail_rotated.height / 2)
            hand_img.paste(nail_rotated, (px, py), nail_rotated)

        # Convert to RGB for JPEG encoding
        result = Image.new("RGB", hand_img.size, (255, 255, 255))
        result.paste(hand_img, mask=hand_img.getchannel("A"))
        return result


def build_design_prompt(shape: str, length: str, design_description: str) -> str:
    """Prompt for text-only design (no composite image available)."""
    return f"""Edit this photo to add photorealistic salon-quality nail art on the hand.

Nail design: {design_description}
Nail shape: {shape} | Nail length: {length}

Rules:
- Apply ONLY inside the white-masked nail regions.
- Nails must be three-dimensional, glossy, and lit to match the hand photo.
- Match the exact colours and patterns described above.
- Do not alter skin, fingers, background, jewellery, or anything outside the nails.
- Result must look like a real photograph of a freshly manicured hand.
- Do not add text, watermarks, or extra objects."""


def build_realistic_prompt(shape: str, length: str, design_description: str) -> str:
    """Prompt when the source image already has the drawn nail designs composited on."""
    return f"""This photo shows a hand with flat drawn nail designs already placed on it.
Make those nail designs look completely photorealistic and salon-quality.

Design reference: {design_description}
Nail shape: {shape} | Nail length: {length}

Rules:
- Reproduce the EXACT same colours and patterns already visible in the nail areas — do not change them.
- Add realistic three-dimensional depth, proper shine or finish ({design_description.split(';')[0]}), and lighting that matches the rest of the hand photo.
- Blend the nail edges naturally with the skin.
- Do not alter skin, fingers, background, jewellery, or anything outside the nails.
- The result must look like a real photograph of a professionally manicured hand.
- Do not add text, watermarks, or extra objects."""


def generate_from_design(
    hand_photo_b64: str,
    mask_b64: str,
    design_description: str,
    shape: str = "oval",
    length: str = "medium",
    design_images: list | None = None,
    nail_positions: list | None = None,
    size_multiplier: float = 1.0,
) -> str:
    """
    Accept base64 image/mask from the browser plus optional design images,
    composite if possible, then call OpenAI image edit.
    Returns base64 PNG of the result.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise MissingAPIKeyError(
            "OPENAI_API_KEY is missing. Add it to your .env file and restart."
        )

    os.makedirs(RESULTS_FOLDER, exist_ok=True)
    client = OpenAI(api_key=api_key)
    model, quality = get_image_settings()

    length_mult = LENGTH_MULTS.get(length, 1.0)

    # ── Composite branch: draw designs onto hand before sending ──────────
    use_composite = bool(design_images and nail_positions)

    if use_composite:
        try:
            composite_img = composite_nail_designs(
                hand_photo_b64, nail_positions, design_images,
                shape, length_mult, size_multiplier,
            )
            # Encode composite as JPEG
            comp_io = io.BytesIO()
            composite_img.save(comp_io, format="JPEG", quality=92, optimize=True)
            comp_io.seek(0)
            comp_b64 = base64.b64encode(comp_io.read()).decode()

            img_io, mask_io = prepare_base64_image_and_mask(comp_b64, mask_b64)
            prompt = build_realistic_prompt(shape, length, design_description)
        except Exception as err:
            # Fall back gracefully to text-only approach
            log_openai_error("Composite failed, falling back to text-only", err)
            use_composite = False

    if not use_composite:
        img_io, mask_io = prepare_base64_image_and_mask(hand_photo_b64, mask_b64)
        prompt = build_design_prompt(shape, length, design_description)

    result_filename = f"nail_preview_{uuid4().hex}.png"
    result_path = os.path.join(RESULTS_FOLDER, result_filename)

    try:
        result = client.images.edit(
            model=model,
            image=img_io,
            mask=mask_io,
            prompt=prompt,
            size="auto",
            quality=quality,
            output_format="png",
            n=1,
        )

        image_base64 = result.data[0].b64_json
        with open(result_path, "wb") as f:
            f.write(base64.b64decode(image_base64))

        return image_base64

    except BadRequestError as error:
        log_openai_error("BadRequestError in generate_from_design", error)
        if looks_like_model_access_error(error):
            raise AIGenerationError(model_fallback_message()) from error
        raise AIGenerationError(
            "The AI could not process this image. Try a clearer hand photo with good lighting."
        ) from error

    except (NotFoundError, PermissionDeniedError) as error:
        log_openai_error("Model access error in generate_from_design", error)
        raise AIGenerationError(model_fallback_message()) from error

    except RateLimitError as error:
        log_openai_error("Rate limit in generate_from_design", error)
        raise AIGenerationError(
            "The AI service is temporarily unavailable. Please try again in a moment."
        ) from error

    except APIError as error:
        log_openai_error("APIError in generate_from_design", error)
        raise AIGenerationError(
            "The AI service had a temporary problem. Please try again."
        ) from error

    except Exception as error:
        log_openai_error("Unexpected error in generate_from_design", error)
        raise AIGenerationError(
            "Sorry, the AI preview could not be generated. Please try again."
        ) from error


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
