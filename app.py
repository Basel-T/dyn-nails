import os
from uuid import uuid4

from dotenv import load_dotenv
from flask import Flask, flash, redirect, render_template, request, url_for
from werkzeug.utils import secure_filename

from ai_service import AIGenerationError, MissingAPIKeyError, generate_nail_preview


# Load environment variables from a local .env file.
# This lets you keep your API key out of the code.
load_dotenv()

# Create the Flask app.
# Flask uses this object to know where templates and static files live.
app = Flask(__name__)

# Flask needs a secret key to safely show "flash" messages.
# For a real deployed app, this should come from an environment variable.
app.secret_key = "dev-secret-key-change-later"

# Uploaded photos will be saved in static/uploads/.
# Because the folder is inside static/, Flask can serve the saved image back
# to the browser with url_for("static", filename="uploads/your-file.jpg").
UPLOAD_FOLDER = os.path.join(app.static_folder, "uploads")
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

# User-painted nail masks will be saved in static/masks/.
MASK_FOLDER = os.path.join(app.static_folder, "masks")
app.config["MASK_FOLDER"] = MASK_FOLDER

# AI-generated images will be saved in static/results/.
RESULTS_FOLDER = os.path.join(app.static_folder, "results")
app.config["RESULTS_FOLDER"] = RESULTS_FOLDER

# Make sure upload/result folders exist before the first request.
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(MASK_FOLDER, exist_ok=True)
os.makedirs(RESULTS_FOLDER, exist_ok=True)

# Keep uploads simple and image-only for this MVP.
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}

# These are the style choices shown on the homepage.
NAIL_STYLES = [
    "Classic French",
    "Nude Glossy",
    "Red Almond",
    "Pink Chrome",
    "Milky White",
    "Black Glossy",
    "Glitter Accent",
    "Baby Boomer Ombre",
]


def allowed_file(filename):
    """Return True when the uploaded file has an allowed image extension."""
    if "." not in filename:
        return False

    # Split on the last dot and check the extension in lowercase.
    extension = filename.rsplit(".", 1)[1].lower()
    return extension in ALLOWED_EXTENSIONS


def allowed_mask_file(filename):
    """Return True when the uploaded mask is a PNG file."""
    return "." in filename and filename.rsplit(".", 1)[1].lower() == "png"


@app.route("/", methods=["GET", "POST"])
def index():
    """Show the upload form and handle form submissions."""
    result = None

    if request.method == "POST":
        uploaded_file = request.files.get("hand_photo")
        mask_file = request.files.get("nail_mask")
        selected_style = request.form.get("nail_style")
        selected_shape = request.form.get("selected_shape", "oval")
        selected_length = request.form.get("selected_length", "medium")

        # Make sure a photo was included in the form submission.
        if not uploaded_file or uploaded_file.filename == "":
            flash("Please upload a hand photo before generating a preview.")
            return redirect(url_for("index"))

        # Make sure the selected style is one of our predefined choices.
        if selected_style not in NAIL_STYLES:
            flash("Please choose one of the nail styles.")
            return redirect(url_for("index"))

        # Validate the file extension before saving anything.
        if not allowed_file(uploaded_file.filename):
            flash("Please upload a JPG, JPEG, PNG, or WEBP image.")
            return redirect(url_for("index"))

        # Make sure a user-painted nail mask was included.
        if not mask_file or mask_file.filename == "":
            flash("Please add at least one nail guide before generating.")
            return redirect(url_for("index"))

        # The OpenAI image edit API expects the mask to be a PNG.
        if not allowed_mask_file(mask_file.filename):
            flash("Please add at least one nail guide before generating.")
            return redirect(url_for("index"))

        # secure_filename removes unsafe characters from the original name.
        # uuid4 adds a unique prefix so different users/files do not overwrite
        # each other when they upload images with the same filename.
        safe_name = secure_filename(uploaded_file.filename)
        unique_name = f"{uuid4().hex}_{safe_name}"
        save_path = os.path.join(app.config["UPLOAD_FOLDER"], unique_name)

        # Save the original uploaded image locally.
        # We display this original photo on the result page.
        uploaded_file.save(save_path)

        mask_name = f"{uuid4().hex}_nail_mask.png"
        mask_path = os.path.join(app.config["MASK_FOLDER"], mask_name)
        mask_file.save(mask_path)

        try:
            # Ask OpenAI to generate the nail preview.
            # The helper returns a local path like static/results/file.png.
            generated_path = generate_nail_preview(
                save_path,
                mask_path,
                selected_style,
                selected_shape,
                selected_length,
            )

            # Convert local file paths into browser URLs.
            original_image_url = url_for("static", filename=f"uploads/{unique_name}")
            generated_filename = os.path.basename(generated_path)
            generated_image_url = url_for(
                "static",
                filename=f"results/{generated_filename}",
            )

            # Build the data that the template will use for the result section.
            result = {
                "original_image_url": original_image_url,
                "generated_image_url": generated_image_url,
                "selected_style": selected_style,
                "message": "Your AI nail preview is ready.",
            }

        except MissingAPIKeyError as error:
            flash(str(error))
            return redirect(url_for("index"))

        except AIGenerationError as error:
            flash(str(error))
            return redirect(url_for("index"))

    return render_template("index.html", styles=NAIL_STYLES, result=result)


if __name__ == "__main__":
    # debug=True automatically reloads the app when you change the code.
    # Keep this for local development only.
    app.run(debug=True, host="0.0.0.0", port=5000)
