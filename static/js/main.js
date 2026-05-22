// Mobile nail guide editor for DYN.
//
// If you want to edit the masking behavior, start in the "MASK EDITOR GUIDE MODEL"
// section below. The important flow is:
// 1. A guide is created from 5 local points in defaultLocalHandles().
// 2. The user drags those points in updateGuideFromHandleDrag().
// 3. The white guide shape is drawn in drawGuidePath() from SVG templates.
// 4. The final black/white mask is exported in buildMaskCanvas().
document.addEventListener("DOMContentLoaded", function () {
    const fileInput = document.getElementById("hand_photo");
    const maskInput = document.getElementById("nail_mask");
    const selectedShapeInput = document.getElementById("selected_shape");
    const selectedLengthInput = document.getElementById("selected_length");
    const form = document.querySelector(".preview-form");
    const submitButton = document.getElementById("submitButton");
    const uploadBox = document.getElementById("uploadBox");
    const uploadPlaceholder = document.getElementById("uploadPlaceholder");
    const uploadPreview = document.getElementById("uploadPreview");
    const uploadPreviewImage = document.getElementById("uploadPreviewImage");
    const changePhotoButton = document.getElementById("changePhotoButton");

    const uploadStep = document.getElementById("uploadStep");
    const styleStep = document.getElementById("styleStep");
    const maskStep = document.getElementById("maskStep");
    const uploadTab = document.getElementById("uploadTab");
    const styleTab = document.getElementById("styleTab");
    const maskTab = document.getElementById("maskTab");
    const goToStylesButton = document.getElementById("goToStylesButton");
    const goToMaskButton = document.getElementById("goToMaskButton");
    const backToUploadButton = document.getElementById("backToUploadButton");
    const backToStylesButton = document.getElementById("backToStylesButton");
    const topGenerateButton = document.getElementById("topGenerateButton");
    const bottomGenerateButton = document.getElementById("bottomGenerateButton");
    const savedNailsCount = document.getElementById("savedNailsCount");
    const editorInstruction = document.getElementById("editorInstruction");
    const styleInputs = document.querySelectorAll("input[name='nail_style']");

    // Canvas/editor elements used only on the mask editor page.
    const canvasWrap = document.getElementById("maskCanvasWrap");
    const guideCanvas = document.getElementById("guideCanvas");
    const lengthSlider = document.getElementById("lengthSlider");
    const widthSlider = document.getElementById("widthSlider");
    const saveNailButton = document.getElementById("saveNailButton");
    const deleteNailButton = document.getElementById("deleteNailButton");
    const addNailButton = document.getElementById("addNailButton");
    const viewFullButton = document.getElementById("viewFullButton");
    const undoButton = document.getElementById("undoButton");
    const visibleShapeSelect = document.getElementById("visibleShapeSelect");
    const shapePickerTrigger = document.getElementById("shapePickerTrigger");
    const shapeChoicePanel = document.getElementById("shapeChoicePanel");
    const shapeChoiceButtons = document.querySelectorAll(".shape-choice");
    const visibleRotationSlider = document.getElementById("visibleRotationSlider");
    const sizeSlider = document.getElementById("sizeSlider");
    const sharpnessSlider = document.getElementById("sharpnessSlider");
    const symmetryToggleButton = document.getElementById("symmetryToggleButton");

    if (!form) {
        return;
    }

    const context = guideCanvas.getContext("2d");

    let uploadedImage = null;
    let imageObjectUrl = "";
    // All nail guides currently placed on the image.
    // Each guide has 5 editable points: bottomLeft, bottomRight, topLeft, topRight, tip.
    let guides = [];
    let selectedGuideId = null;
    let nextGuideId = 1;
    let scale = 1;
    let minScale = 1;
    let offsetX = 0;
    let offsetY = 0;
    let draggedHandle = null;
    let draggedGuide = false;
    let lastPointer = null;
    let isRightPanning = false;
    let lastPanPoint = null;
    let activePointers = new Map();
    let pinchGesture = null;
    let pendingCreateTap = null;
    let lastTapTime = 0;
    let isSubmitting = false;
    let lastSavedTemplate = null;
    let undoStack = [];
    let tapInstructionText = "Tap the center of a nail to start.";
    // When true, dragging one side point mirrors the matching opposite point.
    // Turned on/off by the "Symmetry ON/OFF" button.
    let symmetryEnabled = true;

    function showStep(stepName) {
        uploadStep.hidden = stepName !== "upload";
        styleStep.hidden = stepName !== "style";
        maskStep.hidden = stepName !== "mask";

        uploadTab.classList.toggle("is-active", stepName === "upload");
        styleTab.classList.toggle("is-active", stepName === "style");
        maskTab.classList.toggle("is-active", stepName === "mask");
        document.body.classList.toggle("editor-active", stepName === "mask");

        window.scrollTo({ top: 0, behavior: "smooth" });

        if (stepName === "mask") {
            resizeCanvas();
            viewFullHand();
        }
    }

    function resizeCanvas() {
        if (!uploadedImage) {
            return;
        }

        const wrapWidth = canvasWrap.clientWidth;
        const maxHeight = canvasWrap.clientHeight || Math.round(window.innerHeight * 0.78);
        const imageRatio = uploadedImage.naturalWidth / uploadedImage.naturalHeight;
        const idealHeight = Math.round(wrapWidth / imageRatio);

        guideCanvas.width = wrapWidth;
        guideCanvas.height = Math.min(Math.max(idealHeight, 330), maxHeight);

        minScale = Math.min(
            guideCanvas.width / uploadedImage.naturalWidth,
            guideCanvas.height / uploadedImage.naturalHeight,
        );

        if (scale < minScale) {
            scale = minScale;
        }

        clampView();
    }

    function clampView() {
        if (!uploadedImage) {
            return;
        }

        const drawnWidth = uploadedImage.naturalWidth * scale;
        const drawnHeight = uploadedImage.naturalHeight * scale;

        if (drawnWidth <= guideCanvas.width) {
            offsetX = (guideCanvas.width - drawnWidth) / 2;
        } else {
            offsetX = Math.min(0, Math.max(guideCanvas.width - drawnWidth, offsetX));
        }

        if (drawnHeight <= guideCanvas.height) {
            offsetY = (guideCanvas.height - drawnHeight) / 2;
        } else {
            offsetY = Math.min(0, Math.max(guideCanvas.height - drawnHeight, offsetY));
        }
    }

    function viewFullHand() {
        if (!uploadedImage) {
            return;
        }

        scale = minScale;
        offsetX = (guideCanvas.width - uploadedImage.naturalWidth * scale) / 2;
        offsetY = (guideCanvas.height - uploadedImage.naturalHeight * scale) / 2;
        render();
    }

    function centerViewOnGuide(guide) {
        const targetScale = Math.min(minScale * 5.2, 3.5);

        scale = Math.max(minScale, targetScale);
        offsetX = guideCanvas.width * 0.44 - guide.center.x * scale;
        offsetY = guideCanvas.height * 0.34 - guide.center.y * scale;
        clampView();
        render();
    }

    function imageToScreen(point) {
        return {
            x: point.x * scale + offsetX,
            y: point.y * scale + offsetY,
        };
    }

    function screenToImage(screenX, screenY) {
        const rect = guideCanvas.getBoundingClientRect();

        return {
            x: (screenX - rect.left - offsetX) / scale,
            y: (screenY - rect.top - offsetY) / scale,
        };
    }

    function eventToCanvasPoint(event) {
        const rect = guideCanvas.getBoundingClientRect();

        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
    }

    function distanceBetweenPoints(pointA, pointB) {
        return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
    }

    function midpoint(pointA, pointB) {
        return {
            x: (pointA.x + pointB.x) / 2,
            y: (pointA.y + pointB.y) / 2,
        };
    }

    function zoomAtCanvasPoint(nextScale, canvasPoint) {
        const imagePoint = {
            x: (canvasPoint.x - offsetX) / scale,
            y: (canvasPoint.y - offsetY) / scale,
        };

        scale = clamp(nextScale, minScale, Math.max(minScale * 7, 4));
        offsetX = canvasPoint.x - imagePoint.x * scale;
        offsetY = canvasPoint.y - imagePoint.y * scale;
        clampView();
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function guideBaseSize() {
        if (!uploadedImage) {
            return 600;
        }

        return Math.min(uploadedImage.naturalWidth, uploadedImage.naturalHeight);
    }

    // ---------------------------------------------------------------------
    // MASK EDITOR GUIDE MODEL
    // ---------------------------------------------------------------------
    // This is the main section to edit if you want to change how nail masks
    // behave.
    //
    // Coordinates here are "local" to the nail guide, not screen pixels:
    // - x is left/right across the nail
    // - y is bottom/top along the nail
    // - guide.rotation later turns those local points on the actual hand photo
    //
    // The guide has 5 main editable local points:
    // - bottomLeft / bottomRight: cuticle/base corners
    // - topLeft / topRight: upper corners; these control length and top width
    // - tip: top-center apex; this controls pointiness/curve
    //
    // When Symmetry is OFF, two extra side-control points appear:
    // - sideLeft / sideRight: control where the side curves pull toward.
    //
    // The same points are used for both the visible overlay and exported mask.

    // Overall safety limits for a guide. If the nail guide feels too small or
    // too large by default, these values and defaultLocalHandles() are the first
    // places to tune.
    function guideLimits() {
        const base = guideBaseSize();
        return {
            minLength: Math.max(34, base * 0.052),
            maxLength: Math.max(88, base * 0.24),
            minWidth: Math.max(14, base * 0.022),
            maxWidth: Math.max(50, base * 0.12),
        };
    }

    function guideFrame(guide) {
        const radians = (guide.rotation * Math.PI) / 180;

        return {
            axisWidth: { x: Math.cos(radians), y: Math.sin(radians) },
            axisLength: { x: Math.sin(radians), y: -Math.cos(radians) },
        };
    }

    function localToImage(guide, localX, localY) {
        const frame = guideFrame(guide);

        return {
            x: guide.center.x + localX * frame.axisWidth.x + localY * frame.axisLength.x,
            y: guide.center.y + localX * frame.axisWidth.y + localY * frame.axisLength.y,
        };
    }

    function imageToLocal(point, guide) {
        const frame = guideFrame(guide);
        const dx = point.x - guide.center.x;
        const dy = point.y - guide.center.y;

        return {
            x: dx * frame.axisWidth.x + dy * frame.axisWidth.y,
            y: dx * frame.axisLength.x + dy * frame.axisLength.y,
        };
    }

    function normalizedShape(shape) {
        // Older saved guides may still say "coffin"; the reference image calls
        // that same flat/tapered silhouette "Ballerina".
        return shape === "coffin" ? "ballerina" : shape || "oval";
    }

    // ---------------------------------------------------------------------
    // SVG SHAPE TEMPLATES
    // ---------------------------------------------------------------------
    // These are normalized versions of the SVG files in the project "Shapes"
    // folder. Each path fits inside a 100x100 coordinate box:
    // - x = 0 is left, x = 100 is right
    // - y = 0 is the top/tip, y = 100 is the base/cuticle
    //
    // The editor draws these exact paths for BOTH:
    // - the visible white guide on the photo
    // - the exported black/white mask sent to Flask/OpenAI
    //
    // If you replace a SVG in the Shapes folder later, regenerate/update the
    // matching path string here.
    const SVG_SHAPE_TEMPLATES = {
        oval: "M 50 0.617 C 79.876 0 93.632 14.105 97.319 24.044 L 100 84.621 C 95.427 91.812 80.774 99.305 50 100 C 19.226 99.305 4.573 91.812 0 84.621 L 2.681 24.044 C 6.368 14.105 20.124 0 50 0.617 Z",
        squoval: "M 34.088 0 L 65.15 0.183 C 87.464 0.79 99.238 6.731 100 17.081 L 100 82.144 C 97.725 92.232 80.095 100 50.185 98.77 C 20.276 100 2.645 92.232 0.381 81.961 L 0 15.989 C 0.751 6.731 11.774 0.79 34.088 0 Z",
        square: "M 33.878 0.304 L 66.539 0.304 C 83.675 0.304 95.563 2.64 95.563 7.213 L 100 85.061 C 98.795 95.714 80.158 100 50.005 98.879 C 19.853 100 1.216 95.714 0 85.669 L 4.448 7.213 C 4.448 2.64 16.731 0 33.878 0.304 Z",
        ballerina: "M 29.529 0 L 71.812 0 C 89.697 23.329 98.659 49.458 100 79.949 C 92.959 90.244 78.208 99.466 50.006 100 C 21.805 99.466 7.041 90.244 0 80.75 C 1.792 49.458 11.386 23.329 29.529 0 Z",
        stiletto: "M 50.19 0 C 73.366 10.15 87.524 24.159 92.609 38.031 C 100 63.444 95.718 79.549 95.718 79.549 C 91.827 90.252 74.455 99.475 50.19 100 C 25.925 99.475 8.554 90.252 4.282 79.374 C 0 63.359 5.836 42.473 5.836 42.473 C 12.709 24.069 27.014 10.041 50.19 0 Z",
        almond: "M 50 0 C 81.422 2.377 94.122 23.061 99.466 39.025 L 100 80.796 C 94.657 90.398 74.332 99.708 50 100 C 25.668 99.708 5.343 90.398 0 80.796 L 0.534 39.025 C 5.878 23.061 18.578 2.377 50 0 Z",
    };

    const TEMPLATE_HANDLE_NAMES = ["bottomLeft", "bottomRight", "topLeft", "topRight", "tip"];
    const SVG_TEMPLATE_ANCHORS = {
        oval: {
            bottomLeft: { x: 0, y: 84.621 },
            bottomRight: { x: 100, y: 84.621 },
            topLeft: { x: 8.881, y: 14.484 },
            topRight: { x: 91.119, y: 14.484 },
            tip: { x: 50, y: 0.617 },
        },
        squoval: {
            bottomLeft: { x: 0.381, y: 81.961 },
            bottomRight: { x: 100, y: 82.144 },
            topLeft: { x: 34.088, y: 0 },
            topRight: { x: 65.15, y: 0.183 },
            tip: { x: 50, y: 0 },
        },
        square: {
            bottomLeft: { x: 0, y: 85.669 },
            bottomRight: { x: 100, y: 85.061 },
            topLeft: { x: 33.878, y: 0.304 },
            topRight: { x: 66.539, y: 0.304 },
            tip: { x: 50, y: 0.304 },
        },
        ballerina: {
            bottomLeft: { x: 0, y: 80.75 },
            bottomRight: { x: 100, y: 79.949 },
            topLeft: { x: 29.529, y: 0 },
            topRight: { x: 71.812, y: 0 },
            tip: { x: 50, y: 0 },
        },
        stiletto: {
            bottomLeft: { x: 4.282, y: 79.374 },
            bottomRight: { x: 95.718, y: 79.549 },
            topLeft: { x: 14.416, y: 25.617 },
            topRight: { x: 85.584, y: 25.617 },
            tip: { x: 50.19, y: 0 },
        },
        almond: {
            bottomLeft: { x: 0, y: 80.796 },
            bottomRight: { x: 100, y: 80.796 },
            topLeft: { x: 7.637, y: 24.005 },
            topRight: { x: 92.363, y: 24.005 },
            tip: { x: 50, y: 0 },
        },
    };
    const parsedSvgShapeTemplates = {};

    function parseSvgPathData(pathData) {
        const tokens = pathData.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
        const commands = [];
        let index = 0;
        let currentCommand = "";

        function isCommand(token) {
            return /^[a-zA-Z]$/.test(token);
        }

        function nextNumber() {
            return Number(tokens[index++]);
        }

        while (index < tokens.length) {
            if (isCommand(tokens[index])) {
                currentCommand = tokens[index++];
            }

            if (currentCommand === "Z" || currentCommand === "z") {
                commands.push({ command: "Z", values: [] });
                continue;
            }

            const command = currentCommand.toUpperCase();
            const valueCount = command === "M" || command === "L" ? 2 : command === "Q" ? 4 : command === "C" ? 6 : 0;

            if (!valueCount) {
                break;
            }

            while (index < tokens.length && !isCommand(tokens[index])) {
                const values = [];

                for (let count = 0; count < valueCount && index < tokens.length; count += 1) {
                    values.push(nextNumber());
                }

                commands.push({ command, values });

                if (command === "M") {
                    currentCommand = "L";
                }
            }
        }

        return commands;
    }

    function svgShapeCommands(shape) {
        const shapeName = normalizedShape(shape);

        if (!parsedSvgShapeTemplates[shapeName]) {
            parsedSvgShapeTemplates[shapeName] = parseSvgPathData(SVG_SHAPE_TEMPLATES[shapeName]);
        }

        return parsedSvgShapeTemplates[shapeName];
    }

    function drawParsedSvgCommands(canvasContext, commands) {
        canvasContext.beginPath();

        commands.forEach((item) => {
            const v = item.values;

            if (item.command === "M") {
                canvasContext.moveTo(v[0], v[1]);
            } else if (item.command === "L") {
                canvasContext.lineTo(v[0], v[1]);
            } else if (item.command === "Q") {
                canvasContext.quadraticCurveTo(v[0], v[1], v[2], v[3]);
            } else if (item.command === "C") {
                canvasContext.bezierCurveTo(v[0], v[1], v[2], v[3], v[4], v[5]);
            } else if (item.command === "Z") {
                canvasContext.closePath();
            }
        });
    }

    function templateAnchors(shape) {
        return SVG_TEMPLATE_ANCHORS[normalizedShape(shape)] || SVG_TEMPLATE_ANCHORS.oval;
    }

    function localPointFromTemplateBox(box, anchor) {
        return {
            x: box.left + (anchor.x / 100) * box.width,
            y: box.top - (anchor.y / 100) * box.height,
        };
    }

    function defaultTemplateBox(baseWidth, length, shape) {
        const anchors = templateAnchors(shape);
        const bottomSpan = Math.max(1, anchors.bottomRight.x - anchors.bottomLeft.x);
        const boxWidth = baseWidth * (100 / bottomSpan);
        const boxHeight = length;

        return {
            left: -boxWidth / 2,
            right: boxWidth / 2,
            top: length * 0.56,
            bottom: length * 0.56 - boxHeight,
            width: boxWidth,
            height: boxHeight,
        };
    }

    function guideTemplateBox(guide) {
        const local = guide.localHandles;
        const anchors = templateAnchors(guide.shape);
        const minWidth = guideLimits().minWidth;
        const minHeight = guideLimits().minLength;
        const widthCandidates = [];
        const heightCandidates = [];

        function addWidthCandidate(leftName, rightName) {
            const anchorSpan = anchors[rightName].x - anchors[leftName].x;
            const localSpan = local[rightName].x - local[leftName].x;

            if (Math.abs(anchorSpan) > 1 && Math.abs(localSpan) > 1) {
                widthCandidates.push(Math.abs(localSpan) * (100 / Math.abs(anchorSpan)));
            }
        }

        function addHeightCandidate(topName, bottomName) {
            const anchorSpan = anchors[bottomName].y - anchors[topName].y;
            const localSpan = local[topName].y - local[bottomName].y;

            if (Math.abs(anchorSpan) > 1 && Math.abs(localSpan) > 1) {
                heightCandidates.push(Math.abs(localSpan) * (100 / Math.abs(anchorSpan)));
            }
        }

        addWidthCandidate("bottomLeft", "bottomRight");
        addWidthCandidate("topLeft", "topRight");
        addHeightCandidate("tip", "bottomLeft");
        addHeightCandidate("tip", "bottomRight");
        addHeightCandidate("topLeft", "bottomLeft");
        addHeightCandidate("topRight", "bottomRight");

        const width = clamp(
            widthCandidates.reduce((sum, value) => sum + value, 0) / Math.max(1, widthCandidates.length),
            minWidth,
            guideLimits().maxWidth * 1.8,
        );
        const height = clamp(
            heightCandidates.reduce((sum, value) => sum + value, 0) / Math.max(1, heightCandidates.length),
            minHeight,
            guideLimits().maxLength * 1.25,
        );
        const left = TEMPLATE_HANDLE_NAMES.reduce((sum, name) => sum + local[name].x - (anchors[name].x / 100) * width, 0) / TEMPLATE_HANDLE_NAMES.length;
        const top = TEMPLATE_HANDLE_NAMES.reduce((sum, name) => sum + local[name].y + (anchors[name].y / 100) * height, 0) / TEMPLATE_HANDLE_NAMES.length;

        return {
            left,
            right: left + width,
            top,
            bottom: top - height,
            width,
            height,
        };
    }

    function drawSvgTemplateGuidePath(canvasContext, guide) {
        const commands = svgShapeCommands(guide.shape);
        const box = guideTemplateBox(guide);
        const frame = guideFrame(guide);
        const scaleX = box.width / 100;
        const scaleY = -box.height / 100;
        const originX = guide.center.x + box.left * frame.axisWidth.x + box.top * frame.axisLength.x;
        const originY = guide.center.y + box.left * frame.axisWidth.y + box.top * frame.axisLength.y;

        canvasContext.save();
        canvasContext.transform(
            frame.axisWidth.x * scaleX,
            frame.axisWidth.y * scaleX,
            frame.axisLength.x * scaleY,
            frame.axisLength.y * scaleY,
            originX,
            originY,
        );
        drawParsedSvgCommands(canvasContext, commands);
        canvasContext.restore();
    }

    function shapeTemplate(shape, sharpness) {
        const name = normalizedShape(shape);

        if (name === "squoval") {
            return { topHalf: 0.86, topY: 0.42, apexY: 0.02 };
        }

        if (name === "square") {
            return { topHalf: 0.96, topY: 0.42, apexY: 0.018 };
        }

        if (name === "ballerina") {
            return { topHalf: 0.5, topY: 0.44, apexY: 0.018 };
        }

        if (name === "stiletto") {
            return { topHalf: 0.18, topY: 0.47, apexY: 0.24 + sharpness * 0.2 };
        }

        if (name === "almond") {
            return { topHalf: 0.42 - sharpness * 0.08, topY: 0.43, apexY: 0.14 + sharpness * 0.11 };
        }

        // Oval uses the dedicated normalized path in drawOvalGuidePath().
        // These handles define its base corners and rounded top-center height.
        return { topHalf: 0.7, topY: 0.43, apexY: 0.11 };
    }

    // Creates a new 5-point nail guide when the user taps a nail.
    // This controls the DEFAULT SHAPE for Oval / Squoval / Square /
    // Ballerina / Stiletto / Almond.
    // Edit shapeTemplate() if a preset should start wider, narrower, rounder,
    // or sharper.
    function defaultLocalHandles(shape, baseWidth, length, tipRoundness) {
        const anchors = templateAnchors(shape);
        const box = defaultTemplateBox(baseWidth, length, shape);
        const handles = {};

        TEMPLATE_HANDLE_NAMES.forEach((name) => {
            handles[name] = localPointFromTemplateBox(box, anchors[name]);
        });

        return handles;
    }

    // Make a safe copy of a guide's points.
    // This is used when copying the previous saved nail template.
    function cloneLocalHandles(localHandles) {
        return Object.fromEntries(
            Object.entries(localHandles).map(([name, point]) => [name, { x: point.x, y: point.y }]),
        );
    }

    function ensureSideHandles(guide) {
        const local = guide.localHandles;

        if (!local.sideLeft) {
            local.sideLeft = {
                x: local.bottomLeft.x * 0.95,
                y: (local.bottomLeft.y + local.topLeft.y) / 2,
            };
        }

        if (!local.sideRight) {
            local.sideRight = {
                x: local.bottomRight.x * 0.95,
                y: (local.bottomRight.y + local.topRight.y) / 2,
            };
        }
    }

    function cloneGuide(guide) {
        return {
            ...guide,
            center: { x: guide.center.x, y: guide.center.y },
            points: guide.points ? Object.fromEntries(Object.entries(guide.points).map(([name, point]) => [name, { x: point.x, y: point.y }])) : {},
            localHandles: cloneLocalHandles(guide.localHandles),
        };
    }

    function updateUndoButton() {
        undoButton.disabled = undoStack.length === 0;
    }

    function rememberUndoState() {
        undoStack.push({
            guides: guides.map(cloneGuide),
            selectedGuideId,
            lastSavedTemplate: lastSavedTemplate ? {
                ...lastSavedTemplate,
                localHandles: cloneLocalHandles(lastSavedTemplate.localHandles),
            } : null,
        });

        if (undoStack.length > 25) {
            undoStack.shift();
        }

        updateUndoButton();
    }

    function undoLastEditorChange() {
        const previousState = undoStack.pop();

        if (!previousState) {
            return;
        }

        guides = previousState.guides.map(cloneGuide);
        selectedGuideId = previousState.selectedGuideId;
        lastSavedTemplate = previousState.lastSavedTemplate ? {
            ...previousState.lastSavedTemplate,
            localHandles: cloneLocalHandles(previousState.lastSavedTemplate.localHandles),
        } : null;

        updateSavedCount();
        updateUndoButton();

        const guide = selectedGuide();
        if (guide) {
            syncSlidersFromGuide(guide);
            centerViewOnGuide(guide);
        } else {
            updateEditorInstruction();
            viewFullHand();
        }
    }

    // Applies broad safety constraints after creating/resetting a guide.
    // Important: during live dragging we use constrainDraggedGuide() instead,
    // because we do NOT want unrelated points to move while the user drags one
    // point.
    function constrainLocalHandles(guide) {
        const limits = guideLimits();
        const local = guide.localHandles;
        const minHalfWidth = limits.minWidth * 0.5;
        const maxHalfWidth = limits.maxWidth * 0.65;
        const minY = -guide.length * 0.52;
        const shapeName = normalizedShape(guide.shape);
        const maxY = guide.length * (
            shapeName === "stiletto" ? 0.95 :
            shapeName === "almond" ? 0.78 :
            shapeName === "oval" ? 0.68 :
            0.62
        );

        ["bottomLeft", "topLeft"].forEach((name) => {
            local[name].x = clamp(local[name].x, -maxHalfWidth, -minHalfWidth);
        });
        ["bottomRight", "topRight"].forEach((name) => {
            local[name].x = clamp(local[name].x, minHalfWidth, maxHalfWidth);
        });

        local.bottomLeft.y = clamp(local.bottomLeft.y, -guide.length * 0.5, -guide.length * 0.25);
        local.bottomRight.y = clamp(local.bottomRight.y, -guide.length * 0.5, -guide.length * 0.25);
        local.topLeft.y = clamp(local.topLeft.y, guide.length * 0.16, guide.length * 0.58);
        local.topRight.y = clamp(local.topRight.y, guide.length * 0.16, guide.length * 0.58);

        const averageTopY = (local.topLeft.y + local.topRight.y) / 2;
        const maxTopDifference = guide.length * 0.22;
        const maxTipLift = (
            shapeName === "stiletto" ? 0.48 :
            shapeName === "almond" ? 0.34 :
            shapeName === "oval" ? 0.22 :
            0.12
        );

        local.topLeft.y = clamp(local.topLeft.y, averageTopY - maxTopDifference, averageTopY + maxTopDifference);
        local.topRight.y = clamp(local.topRight.y, averageTopY - maxTopDifference, averageTopY + maxTopDifference);
        local.tip.x = clamp(local.tip.x, local.topLeft.x * 0.65, local.topRight.x * 0.65);
        local.tip.y = clamp(local.tip.y, averageTopY - guide.length * 0.1, averageTopY + guide.length * maxTipLift);

        Object.values(local).forEach((point) => {
            point.y = clamp(point.y, minY, maxY);
        });
    }

    function constrainGuide(guide) {
        const limits = guideLimits();

        guide.length = clamp(guide.length, limits.minLength, limits.maxLength);
        guide.rotation = clamp(guide.rotation, -45, 45);
        guide.tipRoundness = clamp(guide.tipRoundness ?? 70, 0, 100);
        guide.roundness = guide.tipRoundness;
        guide.localHandles = guide.localHandles || defaultLocalHandles(guide.shape, guide.baseWidth, guide.length, guide.tipRoundness);

        if (SVG_SHAPE_TEMPLATES[normalizedShape(guide.shape)]) {
            updateGuideMetricsFromHandles(guide);
            updateGuidePoints(guide);
            return;
        }

        ensureSideHandles(guide);
        constrainLocalHandles(guide);
        updateGuideMetricsFromHandles(guide);
        updateGuidePoints(guide);
    }

    // Rebuilds guide measurements after local points change.
    // Note: guide.length intentionally comes from topLeft/topRight vs bottom
    // points, NOT from the tip. The tip controls pointiness, not main length.
    function updateGuideMetricsFromHandles(guide) {
        const local = guide.localHandles;

        guide.baseWidth = Math.abs(local.bottomLeft.x) + Math.abs(local.bottomRight.x);
        guide.middleWidth = Math.max(guide.baseWidth, Math.abs(local.topLeft.x) + Math.abs(local.topRight.x));
        guide.tipWidth = Math.abs(local.topLeft.x) + Math.abs(local.topRight.x);
        guide.width = guide.baseWidth;
        guide.length = clamp(
            Math.max(local.topLeft.y, local.topRight.y) - Math.min(local.bottomLeft.y, local.bottomRight.y),
            guideLimits().minLength,
            guideLimits().maxLength,
        );
    }

    // Converts the 5 local points into real image coordinates.
    // drawHandles() uses guide.points, so this controls where the visible dots
    // appear on the canvas.
    function updateGuidePoints(guide) {
        const anchors = templateAnchors(guide.shape);
        const box = guideTemplateBox(guide);

        guide.points = Object.fromEntries(
            TEMPLATE_HANDLE_NAMES.map((name) => {
                const localPoint = localPointFromTemplateBox(box, anchors[name]);
                return [name, localToImage(guide, localPoint.x, localPoint.y)];
            }),
        );
    }

    function scaleGuideLocalHandles(guide, factor) {
        Object.values(guide.localHandles).forEach((point) => {
            point.x *= factor;
            point.y *= factor;
        });

        guide.sizeValue = clamp((guide.sizeValue || 100) * factor, Number(sizeSlider.min), Number(sizeSlider.max));
        updateGuideMetricsFromHandles(guide);
        updateGuidePoints(guide);
    }

    // Creates a new nail guide at the tapped image location.
    // If lastSavedTemplate exists, the new nail starts from the previous saved
    // nail's shape/proportions.
    function createGuide(center) {
        const shape = visibleShapeSelect.value;
        const width = Number(widthSlider.value);
        const length = Number(lengthSlider.value) * 0.58;
        const rotation = Number(visibleRotationSlider.value);
        const tipRoundness = Number(sharpnessSlider.value);
        // Oval starts a little wider by default, but uses the same normalized
        // oval path, so the shape proportions do not change.
        const baseWidth = width * (normalizedShape(shape) === "oval" ? 0.72 : 0.55);
        const template = lastSavedTemplate;
        // Reuse almost the same size as the previous saved nail.
        // This makes placing the next nail much faster because the user is
        // usually working across fingers in the same photo.
        const templateScale = template ? 1 : 1;
        const guide = template ? {
            id: String(nextGuideId++),
            center,
            width: template.baseWidth * templateScale,
            baseWidth: template.baseWidth * templateScale,
            middleWidth: template.middleWidth * templateScale,
            tipWidth: template.tipWidth * templateScale,
            length: template.length * templateScale,
            rotation: template.rotation,
            roundness: template.tipRoundness,
            tipRoundness: template.tipRoundness,
            sizeValue: template.sizeValue || 100,
            shape: template.shape,
            saved: false,
            points: {},
            localHandles: cloneLocalHandles(template.localHandles),
        } : {
            id: String(nextGuideId++),
            center,
            width,
            baseWidth,
            middleWidth: baseWidth * 1.08,
            tipWidth: baseWidth * 0.76,
            length,
            rotation,
            roundness: tipRoundness,
            tipRoundness,
            sizeValue: 100,
            shape,
            saved: false,
            points: {},
            localHandles: defaultLocalHandles(shape, baseWidth, length, tipRoundness),
        };

        if (template) {
            Object.values(guide.localHandles).forEach((point) => {
                point.x *= templateScale;
                point.y *= templateScale;
            });
        }

        if (template) {
            // A copied template should keep the exact shape the user just
            // adjusted. Do not run constrainGuide() or update metrics here:
            // both can reinterpret the copied points and distort the next nail.
            ensureSideHandles(guide);
            updateGuidePoints(guide);
        } else {
            constrainGuide(guide);
        }
        return guide;
    }

    function templateFromGuide(guide) {
        ensureSideHandles(guide);

        return {
            shape: guide.shape,
            length: guide.length,
            baseWidth: guide.baseWidth,
            middleWidth: guide.middleWidth,
            tipWidth: guide.tipWidth,
            tipRoundness: guide.tipRoundness,
            sizeValue: guide.sizeValue || 100,
            rotation: guide.rotation,
            localHandles: cloneLocalHandles(guide.localHandles),
        };
    }

    function selectedGuide() {
        return guides.find((guide) => guide.id === selectedGuideId);
    }

    function syncSlidersFromGuide(guide) {
        if (!guide) {
            return;
        }

        widthSlider.value = Math.round(guide.baseWidth);
        lengthSlider.value = Math.round(guide.length);
        visibleShapeSelect.value = guide.shape;
        updateShapeChoiceButtons(guide.shape);
        visibleRotationSlider.value = Math.round(guide.rotation);
        sizeSlider.value = Math.round(guide.sizeValue || 100);
        sharpnessSlider.value = Math.round(guide.tipRoundness);
        selectedShapeInput.value = guide.shape;
        selectedLengthInput.value = lengthLabel(guide.length);
    }

    function updateSelectedGuideFromSliders() {
        const guide = selectedGuide();

        if (!guide) {
            selectedShapeInput.value = visibleShapeSelect.value;
            selectedLengthInput.value = lengthLabel(Number(lengthSlider.value));
            updateShapeChoiceButtons(visibleShapeSelect.value);
            return;
        }

        guide.shape = visibleShapeSelect.value;
        guide.rotation = Number(visibleRotationSlider.value);
        guide.tipRoundness = Number(sharpnessSlider.value);
        constrainGuide(guide);
        visibleRotationSlider.value = Math.round(guide.rotation);
        sharpnessSlider.value = Math.round(guide.tipRoundness);
        selectedShapeInput.value = guide.shape;
        selectedLengthInput.value = lengthLabel(guide.length);
        updateShapeChoiceButtons(guide.shape);
        render();
    }

    function updateShapeChoiceButtons(shapeValue) {
        const selectedOption = visibleShapeSelect.querySelector(`option[value="${shapeValue}"]`);

        shapePickerTrigger.textContent = selectedOption ? selectedOption.textContent : shapeValue;
        shapeChoiceButtons.forEach((button) => {
            const isActive = button.dataset.shape === shapeValue;

            button.classList.toggle("is-active", isActive);
            button.setAttribute("aria-pressed", String(isActive));
        });
    }

    function closeShapePicker() {
        shapeChoicePanel.hidden = true;
        shapePickerTrigger.setAttribute("aria-expanded", "false");
    }

    function toggleShapePicker() {
        const willOpen = shapeChoicePanel.hidden;

        shapeChoicePanel.hidden = !willOpen;
        shapePickerTrigger.setAttribute("aria-expanded", String(willOpen));
    }

    function updateSelectedGuideFromFineControls(event) {
        const guide = selectedGuide();

        if (!guide) {
            selectedShapeInput.value = visibleShapeSelect.value;
            updateShapeChoiceButtons(visibleShapeSelect.value);
            return;
        }

        const nextShape = visibleShapeSelect.value;
        const shapeChanged = guide.shape !== nextShape || event?.target === visibleShapeSelect;
        guide.shape = nextShape;
        guide.rotation = Number(visibleRotationSlider.value);
        guide.tipRoundness = Number(sharpnessSlider.value);
        guide.roundness = guide.tipRoundness;

        if (event?.target === sizeSlider) {
            const previousSize = guide.sizeValue || 100;
            const nextSize = Number(sizeSlider.value);
            scaleGuideLocalHandles(guide, nextSize / previousSize);
            guide.sizeValue = nextSize;
        }

        if (shapeChanged) {
            guide.localHandles = defaultLocalHandles(guide.shape, guide.baseWidth, guide.length, guide.tipRoundness);
            guide.sizeValue = 100;
            sizeSlider.value = "100";
        }
        // Fine controls should not unexpectedly move the user's handle points.
        // In particular, Sharpness changes how curves are DRAWN, but it must
        // not move the tip handle back down to the top-corner line.
        if (shapeChanged) {
            constrainGuide(guide);
        } else {
            guide.rotation = clamp(guide.rotation, -45, 45);
            guide.tipRoundness = clamp(guide.tipRoundness, 0, 100);
            guide.roundness = guide.tipRoundness;
            updateGuideMetricsFromHandles(guide);
            updateGuidePoints(guide);
        }

        selectedShapeInput.value = guide.shape;
        selectedLengthInput.value = lengthLabel(guide.length);
        updateShapeChoiceButtons(guide.shape);
        centerViewOnGuide(guide);
    }

    function lengthLabel(lengthValue) {
        const min = Number(lengthSlider.min);
        const max = Number(lengthSlider.max);
        const third = (max - min) / 3;

        if (lengthValue < min + third) {
            return "short";
        }

        if (lengthValue > max - third) {
            return "long";
        }

        return "medium";
    }

    function drawOvalGuidePath(canvasContext, guide) {
        const local = guide.localHandles;

        // OVAL SHAPE MODEL
        // The oval is intentionally drawn from normalized coordinates inside
        // a nail bounding box:
        // - x: 0.0 left, 0.5 center, 1.0 right
        // - y: 0.0 tip/top, 1.0 base/cuticle
        //
        // This follows the exact oval recipe from the request. The current
        // editor handles define the box:
        // - bottomLeft / bottomRight anchor the left/right base corners
        // - tip anchors the top center
        //
        // Sharpness does NOT move these anchors for Oval. Oval should stretch
        // longer when the guide gets taller, but it should not become almond
        // or stiletto.
        const baseLeftX = local.bottomLeft.x;
        const baseRightX = local.bottomRight.x;
        const baseCornerY = (local.bottomLeft.y + local.bottomRight.y) / 2;
        const tipCenterY = local.tip.y;
        const boxWidth = Math.max(guideLimits().minWidth, (baseRightX - baseLeftX) / 0.4);
        // The oval base corner is drawn at normalized y = 0.92 below.
        // Use that same value here so p(0.30, 0.92) and p(0.70, 0.92)
        // land exactly on the real bottom-left / bottom-right handles.
        const boxHeight = Math.max(guideLimits().minLength, (tipCenterY - baseCornerY) / 0.89);
        const centerX = (baseLeftX + baseRightX) / 2;

        const p = (normalizedX, normalizedY) => {
            const localX = centerX + (normalizedX - 0.5) * boxWidth;
            const localY = tipCenterY - (normalizedY - 0.03) * boxHeight;

            return localToImage(guide, localX, localY);
        };

        canvasContext.beginPath();

        // Start at bottom center cuticle.
        const baseCenter = p(0.5, 1.0);
        canvasContext.moveTo(baseCenter.x, baseCenter.y);

        // Left half of the shallow U-shaped cuticle.
        const baseLeftControl = p(0.36, 1.0);
        // The visible bottom-left handle is the real left base corner.
        const leftBase = localToImage(guide, local.bottomLeft.x, local.bottomLeft.y);
        canvasContext.quadraticCurveTo(baseLeftControl.x, baseLeftControl.y, leftBase.x, leftBase.y);

        // Left side wall: out to widest part, then inward toward the top.
        // These two points control how much the oval sides bulge outward.
        // Moving x closer to the center makes the sides less round.
        const leftSideControlA = p(0.30, 0.76);
        const leftSideControlB = local.sideLeft
            ? localToImage(guide, local.sideLeft.x, local.sideLeft.y)
            : p(0.29, 0.42);
        // This shoulder point is where the side blends into the top.
        // Use the real top-left handle so dragging that point actually changes
        // the oval corner/shoulder.
        const leftTipShoulder = localToImage(guide, local.topLeft.x, local.topLeft.y);
        canvasContext.bezierCurveTo(
            leftSideControlA.x,
            leftSideControlA.y,
            leftSideControlB.x,
            leftSideControlB.y,
            leftTipShoulder.x,
            leftTipShoulder.y,
        );

        // Rounded convex top arc.
        // The top-left, tip, and top-right handles are now all real anchors:
        // - topLeft controls the left top corner/shoulder
        // - tip controls the top height
        // - topRight controls the right top corner/shoulder
        const tipPoint = localToImage(guide, local.tip.x, local.tip.y);
        const rightTipShoulder = localToImage(guide, local.topRight.x, local.topRight.y);
        const topSpan = Math.max(guideLimits().minWidth, local.topRight.x - local.topLeft.x);
        const leftTipControlA = localToImage(
            guide,
            local.topLeft.x * 0.62 + local.tip.x * 0.38,
            local.topLeft.y + (local.tip.y - local.topLeft.y) * 0.78,
        );
        const leftTipControlB = localToImage(guide, local.tip.x - topSpan * 0.22, local.tip.y);
        const rightTipControlA = localToImage(guide, local.tip.x + topSpan * 0.22, local.tip.y);
        const rightTipControlB = localToImage(
            guide,
            local.topRight.x * 0.62 + local.tip.x * 0.38,
            local.topRight.y + (local.tip.y - local.topRight.y) * 0.78,
        );
        canvasContext.bezierCurveTo(
            leftTipControlA.x,
            leftTipControlA.y,
            leftTipControlB.x,
            leftTipControlB.y,
            tipPoint.x,
            tipPoint.y,
        );
        canvasContext.bezierCurveTo(
            rightTipControlA.x,
            rightTipControlA.y,
            rightTipControlB.x,
            rightTipControlB.y,
            rightTipShoulder.x,
            rightTipShoulder.y,
        );

        // Right side wall, mirrored from the left.
        const rightSideControlA = local.sideRight
            ? localToImage(guide, local.sideRight.x, local.sideRight.y)
            : p(0.71, 0.42);
        const rightSideControlB = p(0.70, 0.76);
        // The visible bottom-right handle is the real right base corner.
        const rightBase = localToImage(guide, local.bottomRight.x, local.bottomRight.y);
        canvasContext.bezierCurveTo(
            rightSideControlA.x,
            rightSideControlA.y,
            rightSideControlB.x,
            rightSideControlB.y,
            rightBase.x,
            rightBase.y,
        );

        // Right half of the shallow U-shaped cuticle.
        const baseRightControl = p(0.64, 1.0);
        canvasContext.quadraticCurveTo(baseRightControl.x, baseRightControl.y, baseCenter.x, baseCenter.y);
        canvasContext.closePath();
    }

    function drawSquovalGuidePath(canvasContext, guide) {
        const local = guide.localHandles;
        const p = (x, y) => localToImage(guide, x, y);
        const bottomLeft = p(local.bottomLeft.x, local.bottomLeft.y);
        const bottomRight = p(local.bottomRight.x, local.bottomRight.y);
        const leftSidePoint = local.sideLeft
            ? p(local.sideLeft.x, local.sideLeft.y)
            : p(local.bottomLeft.x * 0.98, (local.bottomLeft.y + local.topLeft.y) / 2);
        const rightSidePoint = local.sideRight
            ? p(local.sideRight.x, local.sideRight.y)
            : p(local.bottomRight.x * 0.98, (local.bottomRight.y + local.topRight.y) / 2);

        // Squoval = square body + smooth rounded top corners.
        // The top edge must stay completely flat, so both top corners use the
        // same local Y value.
        const topY = (local.topLeft.y + local.topRight.y) / 2;
        const topLeft = p(local.topLeft.x, topY);
        const topRight = p(local.topRight.x, topY);
        const topWidth = Math.max(guideLimits().minWidth, local.topRight.x - local.topLeft.x);
        const cornerRadius = Math.min(topWidth * 0.24, guide.length * 0.18);
        const leftCornerStart = p(local.topLeft.x, topY - cornerRadius);
        const leftFlatStart = p(local.topLeft.x + cornerRadius, topY);
        const rightFlatEnd = p(local.topRight.x - cornerRadius, topY);
        const rightCornerEnd = p(local.topRight.x, topY - cornerRadius);
        const cuticle = p(
            (local.bottomLeft.x + local.bottomRight.x) / 2,
            Math.min(local.bottomLeft.y, local.bottomRight.y) - guide.length * 0.08,
        );

        canvasContext.beginPath();
        canvasContext.moveTo(bottomLeft.x, bottomLeft.y);

        // Left side stays mostly straight, like a square nail, but keeps a
        // slight curve so it does not look like a hard polygon. The middle
        // side handle is the main curve pull point.
        canvasContext.bezierCurveTo(
            p(local.bottomLeft.x, local.bottomLeft.y + guide.length * 0.16).x,
            p(local.bottomLeft.x, local.bottomLeft.y + guide.length * 0.16).y,
            leftSidePoint.x,
            leftSidePoint.y,
            leftCornerStart.x,
            leftCornerStart.y,
        );

        // Rounded top-left corner into the flat top.
        // The curve ends inside the top edge, not at the outer corner, so this
        // becomes a true rounded squoval corner instead of a sharp square turn.
        canvasContext.bezierCurveTo(
            p(local.topLeft.x, topY - cornerRadius * 0.45).x,
            p(local.topLeft.x, topY - cornerRadius * 0.45).y,
            p(local.topLeft.x + cornerRadius * 0.45, topY).x,
            p(local.topLeft.x + cornerRadius * 0.45, topY).y,
            leftFlatStart.x,
            leftFlatStart.y,
        );

        // The defining squoval feature: a completely flat top side between
        // the two rounded corners.
        canvasContext.lineTo(rightFlatEnd.x, rightFlatEnd.y);

        // Rounded top-right corner.
        canvasContext.bezierCurveTo(
            p(local.topRight.x - cornerRadius * 0.45, topY).x,
            p(local.topRight.x - cornerRadius * 0.45, topY).y,
            p(local.topRight.x, topY - cornerRadius * 0.45).x,
            p(local.topRight.x, topY - cornerRadius * 0.45).y,
            rightCornerEnd.x,
            rightCornerEnd.y,
        );

        // Right side mirrors the square-like left side.
        canvasContext.bezierCurveTo(
            rightSidePoint.x,
            rightSidePoint.y,
            p(local.bottomRight.x, local.bottomRight.y + guide.length * 0.16).x,
            p(local.bottomRight.x, local.bottomRight.y + guide.length * 0.16).y,
            bottomRight.x,
            bottomRight.y,
        );

        // Keep the base softly curved like the other nail masks.
        canvasContext.quadraticCurveTo(cuticle.x, cuticle.y, bottomLeft.x, bottomLeft.y);
        canvasContext.closePath();
    }

    // Draws the actual nail shape from the 5 guide points.
    //
    // This is the MOST IMPORTANT drawing function:
    // - renderGuide() calls it for the visible white overlay
    // - buildMaskCanvas() calls it for the exported black/white mask
    //
    // So if you change this function, preview and mask stay matched.
    function drawGuidePath(canvasContext, guide) {
        const local = guide.localHandles;
        const shape = normalizedShape(guide.shape || "oval");
        const sharpness = clamp(guide.tipRoundness ?? 70, 0, 100) / 100;

        if (SVG_SHAPE_TEMPLATES[shape]) {
            drawSvgTemplateGuidePath(canvasContext, guide);
            return;
        }

        const p = (x, y) => localToImage(guide, x, y);
        const bottomLeft = p(local.bottomLeft.x, local.bottomLeft.y);
        const bottomRight = p(local.bottomRight.x, local.bottomRight.y);
        const topLeft = p(local.topLeft.x, local.topLeft.y);
        const topRight = p(local.topRight.x, local.topRight.y);
        const tip = p(local.tip.x, local.tip.y);
        const cuticle = p(
            (local.bottomLeft.x + local.bottomRight.x) / 2,
            Math.min(local.bottomLeft.y, local.bottomRight.y) - guide.length * 0.1,
        );

        const sideControl = (
            shape === "square" ? 0.02 :
            shape === "squoval" ? 0.045 :
            shape === "ballerina" ? 0.015 :
            shape === "stiletto" ? 0.08 :
            shape === "almond" ? 0.09 :
            0.075
        );
        const lowerLeftSide = p(local.bottomLeft.x * (1 + sideControl), local.bottomLeft.y + guide.length * 0.22);
        const upperLeftSide = p(
            local.topLeft.x + (local.bottomLeft.x - local.topLeft.x) * (shape === "ballerina" || shape === "stiletto" ? 0.08 : 0.02),
            local.topLeft.y - guide.length * 0.16,
        );
        const lowerRightSide = p(local.bottomRight.x * (1 + sideControl), local.bottomRight.y + guide.length * 0.22);
        const upperRightSide = p(
            local.topRight.x + (local.bottomRight.x - local.topRight.x) * (shape === "ballerina" || shape === "stiletto" ? 0.08 : 0.02),
            local.topRight.y - guide.length * 0.16,
        );

        canvasContext.beginPath();
        canvasContext.moveTo(bottomLeft.x, bottomLeft.y);
        canvasContext.bezierCurveTo(lowerLeftSide.x, lowerLeftSide.y, upperLeftSide.x, upperLeftSide.y, topLeft.x, topLeft.y);

        const flatTopShape = shape === "squoval" || shape === "square" || shape === "ballerina";

        // Squoval, Square, and Ballerina/Coffin follow the flat-top examples
        // in the reference image.
        if (flatTopShape) {
            const topY = (local.topLeft.y + local.topRight.y) / 2;
            const topWidth = Math.abs(local.topRight.x - local.topLeft.x);
            const cornerSoftness = topWidth * (
                shape === "squoval" ? 0.24 + (1 - sharpness) * 0.08 :
                shape === "square" ? 0.055 + (1 - sharpness) * 0.04 :
                0.04 + (1 - sharpness) * 0.035
            );
            const leftFlat = p(local.topLeft.x + cornerSoftness, topY);
            const rightFlat = p(local.topRight.x - cornerSoftness, topY);

            canvasContext.quadraticCurveTo(
                p(local.topLeft.x, topY + cornerSoftness * (shape === "squoval" ? 0.85 : 0.45)).x,
                p(local.topLeft.x, topY + cornerSoftness * (shape === "squoval" ? 0.85 : 0.45)).y,
                leftFlat.x,
                leftFlat.y,
            );
            canvasContext.lineTo(rightFlat.x, rightFlat.y);
            canvasContext.quadraticCurveTo(
                p(local.topRight.x, topY + cornerSoftness * (shape === "squoval" ? 0.85 : 0.45)).x,
                p(local.topRight.x, topY + cornerSoftness * (shape === "squoval" ? 0.85 : 0.45)).y,
                topRight.x,
                topRight.y,
            );
        } else {
            // Oval, Stiletto, and Almond are drawn as two OUTWARD-bulging
            // Bezier curves:
            // topLeft -> tip and tip -> topRight.
            //
            // Important mental model:
            // - The visible tip handle is still the middle/top point.
            // - The two curves share one smooth horizontal tangent at the tip.
            //   That removes the "split in half" look.
            // - Sharpness changes the Bezier handles only; it does NOT move
            //   topLeft, topRight, or tip.
            const topSpan = Math.max(guideLimits().minWidth, Math.abs(local.topRight.x - local.topLeft.x));
            const tipHandle = topSpan * (
                shape === "stiletto" ? 0.018 + (1 - sharpness) * 0.035 :
                shape === "almond" ? 0.18 + (1 - sharpness) * 0.12 :
                0.42 + (1 - sharpness) * 0.12
            );
            const shoulderLift = guide.length * (
                shape === "stiletto" ? 0.004 + (1 - sharpness) * 0.008 :
                shape === "almond" ? 0.035 + (1 - sharpness) * 0.03 :
                0.11 + (1 - sharpness) * 0.035
            );
            const shoulderMix = shape === "stiletto" ? 0.44 : shape === "almond" ? 0.68 : 0.88;
            const leftShoulder = p(
                local.topLeft.x * shoulderMix + local.tip.x * (1 - shoulderMix),
                Math.max(local.topLeft.y, local.tip.y) + shoulderLift,
            );
            const leftTipTangent = p(local.tip.x - tipHandle, local.tip.y);
            const rightTipTangent = p(local.tip.x + tipHandle, local.tip.y);
            const rightShoulder = p(
                local.topRight.x * shoulderMix + local.tip.x * (1 - shoulderMix),
                Math.max(local.topRight.y, local.tip.y) + shoulderLift,
            );

            canvasContext.bezierCurveTo(
                leftShoulder.x,
                leftShoulder.y,
                leftTipTangent.x,
                leftTipTangent.y,
                tip.x,
                tip.y,
            );
            canvasContext.bezierCurveTo(
                rightTipTangent.x,
                rightTipTangent.y,
                rightShoulder.x,
                rightShoulder.y,
                topRight.x,
                topRight.y,
            );
        }

        canvasContext.bezierCurveTo(upperRightSide.x, upperRightSide.y, lowerRightSide.x, lowerRightSide.y, bottomRight.x, bottomRight.y);
        // The cuticle/base is one simple connected rounded line.
        // It curves outward slightly instead of being flat or split into pieces.
        canvasContext.quadraticCurveTo(cuticle.x, cuticle.y, bottomLeft.x, bottomLeft.y);
        canvasContext.closePath();
    }

    function renderGuide(guide) {
        const isSelected = guide.id === selectedGuideId;

        context.save();
        context.translate(offsetX, offsetY);
        context.scale(scale, scale);
        drawGuidePath(context, guide);
        context.fillStyle = guide.saved ? "rgba(255, 255, 255, 0.5)" : "rgba(255, 255, 255, 0.48)";
        context.fill();

        // Saved, unselected nails should look clean in full-hand view:
        // keep the soft white fill as a mask preview, but hide border/points.
        if (isSelected || !guide.saved) {
            context.strokeStyle = isSelected ? "rgba(255, 255, 255, 0.68)" : "rgba(255, 255, 255, 0.52)";
            context.lineWidth = (isSelected ? 2.2 : 1.5) / scale;
            context.stroke();
        }
        context.restore();

        if (isSelected) {
            drawHandles(guide);
        }
    }

    function drawHandles(guide) {
        Object.entries(guide.points).forEach(([name, point]) => {
            if (!TEMPLATE_HANDLE_NAMES.includes(name)) {
                return;
            }

            const screenPoint = imageToScreen(point);

            context.beginPath();
            context.arc(screenPoint.x, screenPoint.y, 6.5, 0, Math.PI * 2);
            context.fillStyle = "rgba(255, 255, 255, 0.68)";
            context.fill();
            context.lineWidth = 2;
            context.strokeStyle = "rgba(225, 45, 92, 0.62)";
            context.stroke();
        });
    }

    function render() {
        if (!uploadedImage) {
            return;
        }

        context.clearRect(0, 0, guideCanvas.width, guideCanvas.height);
        context.fillStyle = "#fffdfb";
        context.fillRect(0, 0, guideCanvas.width, guideCanvas.height);

        context.save();
        context.translate(offsetX, offsetY);
        context.scale(scale, scale);
        context.drawImage(uploadedImage, 0, 0);
        context.restore();

        guides.forEach(renderGuide);
    }

    function findHandleAt(screenX, screenY) {
        const guide = selectedGuide();

        if (!guide) {
            return null;
        }

        for (const [name, point] of Object.entries(guide.points)) {
            if (!TEMPLATE_HANDLE_NAMES.includes(name)) {
                continue;
            }

            const screenPoint = imageToScreen(point);

            if (Math.hypot(screenPoint.x - screenX, screenPoint.y - screenY) <= 24) {
                return name;
            }
        }

        return null;
    }

    // Hit-test the filled nail shape, not the handles.
    // This lets the user tap an existing guide to select/edit it again.
    function findGuideAt(imagePoint) {
        for (let index = guides.length - 1; index >= 0; index -= 1) {
            const guide = guides[index];
            const testCanvas = document.createElement("canvas");
            testCanvas.width = 1;
            testCanvas.height = 1;
            const testContext = testCanvas.getContext("2d");

            testContext.translate(-imagePoint.x, -imagePoint.y);
            drawGuidePath(testContext, guide);

            if (testContext.isPointInPath(0, 0)) {
                return guide;
            }
        }

        return null;
    }

    function selectGuide(guide) {
        selectedGuideId = guide.id;
        syncSlidersFromGuide(guide);
        updateEditorInstruction();
        centerViewOnGuide(guide);
    }

    function createAndSelectGuide(imagePoint) {
        rememberUndoState();
        const guide = createGuide(imagePoint);

        guides.push(guide);
        selectGuide(guide);
        updateEditorInstruction();
    }

    function saveSelectedGuide() {
        const guide = selectedGuide();

        if (!guide) {
            alert("Tap the center of a nail first.");
            return;
        }

        rememberUndoState();
        guide.saved = true;
        lastSavedTemplate = templateFromGuide(guide);
        selectedGuideId = null;
        tapInstructionText = "Tap the next nail.";
        updateSavedCount();
        updateEditorInstruction();
        viewFullHand();
    }

    function deleteSelectedGuide() {
        if (!selectedGuideId) {
            return;
        }

        rememberUndoState();
        guides = guides.filter((guide) => guide.id !== selectedGuideId);
        selectedGuideId = guides.length ? guides[guides.length - 1].id : null;
        updateSavedCount();

        if (selectedGuideId) {
            selectGuide(selectedGuide());
        } else {
            updateEditorInstruction();
            render();
        }
    }

    function resetAllGuides() {
        rememberUndoState();
        guides = [];
        selectedGuideId = null;
        lastSavedTemplate = null;
        tapInstructionText = "Tap the center of a nail to start.";
        maskInput.value = "";
        updateSavedCount();
        updateEditorInstruction();
        viewFullHand();
    }

    function updateSavedCount() {
        const count = guides.filter((guide) => guide.saved).length;
        savedNailsCount.textContent = `${count} saved`;
        topGenerateButton.disabled = count === 0;
        bottomGenerateButton.disabled = count === 0;
    }

    function updateEditorInstruction() {
        editorInstruction.textContent = tapInstructionText;
        editorInstruction.hidden = Boolean(selectedGuideId);
    }

    function updateSymmetryButton() {
        symmetryToggleButton.textContent = symmetryEnabled ? "Symmetry ON" : "Symmetry OFF";
        symmetryToggleButton.setAttribute("aria-pressed", String(symmetryEnabled));
        symmetryToggleButton.classList.toggle("is-active", symmetryEnabled);
        if (selectedGuide()) {
            render();
        }
    }

    // Symmetry ON helper.
    // When one side point moves, this mirrors the matching opposite point.
    // Symmetry OFF skips this completely so thumb nails can be asymmetric.
    function mirrorDraggedHandle(guide, handleName) {
        const local = guide.localHandles;

        if (handleName === "bottomLeft") {
            local.bottomRight = { x: -local.bottomLeft.x, y: local.bottomLeft.y };
        } else if (handleName === "bottomRight") {
            local.bottomLeft = { x: -local.bottomRight.x, y: local.bottomRight.y };
        } else if (handleName === "topLeft") {
            local.topRight = { x: -local.topLeft.x, y: local.topLeft.y };
        } else if (handleName === "topRight") {
            local.topLeft = { x: -local.topRight.x, y: local.topRight.y };
        } else if (handleName === "sideLeft") {
            local.sideRight = { x: -local.sideLeft.x, y: local.sideLeft.y };
        } else if (handleName === "sideRight") {
            local.sideLeft = { x: -local.sideRight.x, y: local.sideRight.y };
        } else if (handleName === "tip") {
            local.tip.x = 0;
        }
    }

    // When the user turns Symmetry ON after editing asymmetrically, this makes
    // the selected guide balanced again by averaging left/right pairs.
    function symmetrizeGuide(guide) {
        const local = guide.localHandles;
        const bottomHalf = (Math.abs(local.bottomLeft.x) + Math.abs(local.bottomRight.x)) / 2;
        const bottomY = (local.bottomLeft.y + local.bottomRight.y) / 2;
        const topHalf = (Math.abs(local.topLeft.x) + Math.abs(local.topRight.x)) / 2;
        const topY = (local.topLeft.y + local.topRight.y) / 2;

        local.bottomLeft = { x: -bottomHalf, y: bottomY };
        local.bottomRight = { x: bottomHalf, y: bottomY };
        local.topLeft = { x: -topHalf, y: topY };
        local.topRight = { x: topHalf, y: topY };
        local.tip.x = 0;
        updateGuideMetricsFromHandles(guide);
        updateGuidePoints(guide);
    }

    // Minimal live-drag safety.
    // This is intentionally lighter than constrainGuide(), because point
    // anchoring matters: dragging one point should not move the others.
    //
    // With Symmetry OFF:
    // - only the dragged point is constrained
    // - no unrelated point should move
    //
    // With Symmetry ON:
    // - the mirrored partner may also move via mirrorDraggedHandle()
    function constrainDraggedGuide(guide, handleName) {
        const limits = guideLimits();
        const local = guide.localHandles;
        const minHalfWidth = limits.minWidth * 0.5;
        const maxHalfWidth = limits.maxWidth * 0.8;

        if (handleName === "bottomLeft") {
            local.bottomLeft.x = clamp(local.bottomLeft.x, -maxHalfWidth, -minHalfWidth);
        } else if (handleName === "bottomRight") {
            local.bottomRight.x = clamp(local.bottomRight.x, minHalfWidth, maxHalfWidth);
        } else if (handleName === "topLeft") {
            local.topLeft.x = clamp(local.topLeft.x, -maxHalfWidth, -minHalfWidth * 0.45);
        } else if (handleName === "topRight") {
            local.topRight.x = clamp(local.topRight.x, minHalfWidth * 0.45, maxHalfWidth);
        } else if (handleName === "sideLeft") {
            local.sideLeft.x = clamp(local.sideLeft.x, -maxHalfWidth * 1.25, -minHalfWidth * 0.4);
        } else if (handleName === "sideRight") {
            local.sideRight.x = clamp(local.sideRight.x, minHalfWidth * 0.4, maxHalfWidth * 1.25);
        } else if (handleName === "tip") {
            local.tip.x = clamp(local.tip.x, local.topLeft.x * 0.8, local.topRight.x * 0.8);
        }

        // Prevent concave / inward top curves for rounded/pointed shapes.
        // The tip must stay visually beyond the line between top-left/top-right.
        const shapeName = normalizedShape(guide.shape);

        if (shapeName === "oval" || shapeName === "almond" || shapeName === "stiletto") {
            const topLineY = Math.max(local.topLeft.y, local.topRight.y);
            const minBulge = shapeName === "stiletto" ? guide.length * 0.14 : shapeName === "almond" ? guide.length * 0.07 : guide.length * 0.035;

            if (local.tip.y < topLineY + minBulge) {
                local.tip.y = topLineY + minBulge;
            }
        }

        guide.rotation = clamp(guide.rotation, -45, 45);
        guide.tipRoundness = clamp(guide.tipRoundness ?? 55, 0, 100);
        guide.roundness = guide.tipRoundness;
        updateGuideMetricsFromHandles(guide);
        updateGuidePoints(guide);
    }

    function toggleSymmetry() {
        rememberUndoState();
        symmetryEnabled = !symmetryEnabled;
        updateSymmetryButton();

        const guide = selectedGuide();

        if (symmetryEnabled && guide) {
            symmetrizeGuide(guide);
            render();
        }
    }

    function enterTapNextNailMode() {
        const guide = selectedGuide();

        if (guide) {
            // "Add Nail" should finish the current nail first. Otherwise the
            // user can move on with an unsaved guide, and the next guide may be
            // copied from a half-active editing state.
            guide.saved = true;
            lastSavedTemplate = templateFromGuide(guide);
            updateSavedCount();
        }

        activePointers.clear();
        pinchGesture = null;
        pendingCreateTap = null;
        draggedHandle = null;
        draggedGuide = false;
        lastPointer = null;
        selectedGuideId = null;
        tapInstructionText = guides.some((guide) => guide.saved) ? "Tap the next nail." : "Tap the center of a nail to start.";
        updateEditorInstruction();
        viewFullHand();
    }

    function stepControl(input, amount) {
        const nextValue = Math.min(Number(input.max), Math.max(Number(input.min), Number(input.value) + amount));
        input.value = String(nextValue);
        updateSelectedGuideFromSliders();
    }

    function moveGuideBy(guide, dx, dy) {
        guide.center.x += dx;
        guide.center.y += dy;
        updateGuidePoints(guide);
    }

    // Main drag behavior for the 5 editable points.
    //
    // This is where you should edit point behavior:
    // - topLeft/topRight should change length/top width
    // - tip should change pointiness/apex
    // - bottomLeft/bottomRight should change cuticle/base width
    //
    // The dragged point starts as a screen coordinate, gets converted into
    // guide-local x/y, and then stored in guide.localHandles.
    function updateGuideFromHandleDrag(guide, handleName, imagePoint) {
        const local = imageToLocal(imagePoint, guide);
        const limits = guideLimits();

        if (!guide.localHandles[handleName]) {
            return;
        }

        guide.localHandles[handleName] = local;
        if (symmetryEnabled) {
            mirrorDraggedHandle(guide, handleName);
        }

        if (handleName === "topLeft" || handleName === "topRight" || handleName === "bottomLeft" || handleName === "bottomRight") {
            const handles = guide.localHandles;
            guide.length = clamp(
                Math.max(handles.topLeft.y, handles.topRight.y) - Math.min(handles.bottomLeft.y, handles.bottomRight.y),
                limits.minLength,
                limits.maxLength,
            );
        }

        constrainDraggedGuide(guide, handleName);
    }

    function startPinchGestureIfNeeded() {
        if (activePointers.size < 2) {
            return false;
        }

        // A two-finger gesture is navigation, not "add a nail".
        // Cancel any pending single-finger tap before it creates a guide.
        pendingCreateTap = null;

        const points = Array.from(activePointers.values()).slice(0, 2);
        const center = midpoint(points[0], points[1]);

        draggedHandle = null;
        draggedGuide = false;
        lastPointer = null;
        pinchGesture = {
            startDistance: Math.max(1, distanceBetweenPoints(points[0], points[1])),
            startScale: scale,
            lastCenter: center,
        };

        return true;
    }

    function handlePinchMove() {
        if (activePointers.size < 2 || !pinchGesture) {
            return false;
        }

        const points = Array.from(activePointers.values()).slice(0, 2);
        const center = midpoint(points[0], points[1]);
        const distance = Math.max(1, distanceBetweenPoints(points[0], points[1]));
        const nextScale = pinchGesture.startScale * (distance / pinchGesture.startDistance);

        zoomAtCanvasPoint(nextScale, center);

        // Two-finger drag pans the image after zooming.
        offsetX += center.x - pinchGesture.lastCenter.x;
        offsetY += center.y - pinchGesture.lastCenter.y;
        pinchGesture.lastCenter = center;
        clampView();
        render();

        return true;
    }

    function handlePointerDown(event) {
        if (!uploadedImage) {
            return;
        }

        event.preventDefault();

        // Desktop navigation: right-click drag pans the photo. Keep this
        // separate from left-click nail editing.
        if (event.pointerType === "mouse" && event.button === 2) {
            guideCanvas.setPointerCapture(event.pointerId);
            isRightPanning = true;
            lastPanPoint = eventToCanvasPoint(event);
            pendingCreateTap = null;
            draggedHandle = null;
            draggedGuide = false;
            lastPointer = null;
            return;
        }

        const now = Date.now();

        // Block browser-style double tap zoom, but do NOT block the second
        // finger of our custom pinch gesture. If another pointer is already
        // active, this touch is part of pan/zoom and must be tracked.
        if (event.pointerType === "touch" && activePointers.size === 0 && now - lastTapTime < 320) {
            lastTapTime = 0;
            pendingCreateTap = null;
            return;
        }

        lastTapTime = now;
        guideCanvas.setPointerCapture(event.pointerId);
        activePointers.set(event.pointerId, eventToCanvasPoint(event));

        if (startPinchGestureIfNeeded()) {
            render();
            return;
        }

        const screenPoint = eventToCanvasPoint(event);
        const imagePoint = screenToImage(event.clientX, event.clientY);
        const handleName = findHandleAt(screenPoint.x, screenPoint.y);

        if (handleName) {
            rememberUndoState();
            draggedHandle = handleName;
            return;
        }

        const hitGuide = findGuideAt(imagePoint);

        if (hitGuide) {
            selectGuide(hitGuide);
            rememberUndoState();
            draggedGuide = true;
            lastPointer = imagePoint;
            return;
        }

        // Do not create the guide immediately. Waiting until pointerup lets us
        // cancel cleanly if a second finger joins for pan/zoom.
        pendingCreateTap = {
            pointerId: event.pointerId,
            startScreenPoint: screenPoint,
            imagePoint,
        };
    }

    function handlePointerMove(event) {
        if (isRightPanning && lastPanPoint) {
            event.preventDefault();
            const panPoint = eventToCanvasPoint(event);

            offsetX += panPoint.x - lastPanPoint.x;
            offsetY += panPoint.y - lastPanPoint.y;
            lastPanPoint = panPoint;
            clampView();
            render();
            return;
        }

        if (activePointers.has(event.pointerId)) {
            activePointers.set(event.pointerId, eventToCanvasPoint(event));
        }

        if (pendingCreateTap?.pointerId === event.pointerId) {
            const screenPoint = eventToCanvasPoint(event);

            if (distanceBetweenPoints(screenPoint, pendingCreateTap.startScreenPoint) > 10) {
                pendingCreateTap = null;
            }
        }

        if (activePointers.size >= 2 && !pinchGesture) {
            startPinchGestureIfNeeded();
        }

        if (handlePinchMove()) {
            event.preventDefault();
            return;
        }

        const guide = selectedGuide();

        if (!guide || (!draggedHandle && !draggedGuide)) {
            return;
        }

        event.preventDefault();
        const imagePoint = screenToImage(event.clientX, event.clientY);

        if (draggedHandle) {
            updateGuideFromHandleDrag(guide, draggedHandle, imagePoint);
            render();
            return;
        }

        if (draggedGuide && lastPointer) {
            moveGuideBy(guide, imagePoint.x - lastPointer.x, imagePoint.y - lastPointer.y);
            lastPointer = imagePoint;
            render();
        }
    }

    function stopPointer(event) {
        if (isRightPanning) {
            isRightPanning = false;
            lastPanPoint = null;
            return;
        }

        const shouldCreateFromTap = pendingCreateTap
            && pendingCreateTap.pointerId === event?.pointerId
            && activePointers.size === 1
            && !pinchGesture;

        activePointers.delete(event?.pointerId);

        if (activePointers.size < 2) {
            pinchGesture = null;
        }

        if (activePointers.size === 0) {
            if (shouldCreateFromTap) {
                createAndSelectGuide(pendingCreateTap.imagePoint);
            }

            pendingCreateTap = null;
            draggedHandle = null;
            draggedGuide = false;
            lastPointer = null;
        }
    }

    function buildMaskCanvas() {
        const outputCanvas = document.createElement("canvas");
        outputCanvas.width = uploadedImage.naturalWidth;
        outputCanvas.height = uploadedImage.naturalHeight;
        const outputContext = outputCanvas.getContext("2d");

        // The mask is black everywhere by default. White means "editable area"
        // for OpenAI image editing.
        outputContext.fillStyle = "black";
        outputContext.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
        outputContext.fillStyle = "white";

        // Export the exact same shape shown on-screen.
        // drawGuidePath() is shared by preview and mask export.
        guides.filter((guide) => guide.saved).forEach((guide) => {
            drawGuidePath(outputContext, guide);
            outputContext.fill();
        });

        return outputCanvas;
    }

    function putMaskBlobIntoFileInput(maskBlob) {
        const maskFile = new File([maskBlob], "nail-guides-mask.png", { type: "image/png" });
        const dataTransfer = new DataTransfer();

        dataTransfer.items.add(maskFile);
        maskInput.files = dataTransfer.files;
    }

    function updateImageDependentSliderRanges() {
        const base = Math.min(uploadedImage.naturalWidth, uploadedImage.naturalHeight);

        widthSlider.min = Math.round(base * 0.025);
        widthSlider.max = Math.round(base * 0.16);
        widthSlider.value = Math.round(base * 0.055);
        lengthSlider.min = Math.round(base * 0.055);
        lengthSlider.max = Math.round(base * 0.24);
        lengthSlider.value = Math.round(base * 0.115);
    }

    function showEmptyUploadCard() {
        uploadBox.classList.remove("has-preview");
        uploadPlaceholder.hidden = false;
        uploadPreview.hidden = true;
        uploadPreviewImage.src = "";
    }

    function showUploadPreview(previewUrl) {
        uploadBox.classList.add("has-preview");
        uploadPlaceholder.hidden = true;
        uploadPreview.hidden = false;
        uploadPreviewImage.src = previewUrl;
    }

    function selectedStyle() {
        return document.querySelector("input[name='nail_style']:checked");
    }

    function updateStyleButtonState() {
        goToStylesButton.disabled = !uploadedImage;
        goToMaskButton.disabled = !uploadedImage || !selectedStyle();
    }

    function handleDroppedFile(event) {
        event.preventDefault();
        uploadBox.classList.remove("is-dragging");

        if (!event.dataTransfer.files.length) {
            return;
        }

        fileInput.files = event.dataTransfer.files;
        fileInput.dispatchEvent(new Event("change"));
    }

    fileInput.addEventListener("change", function () {
        const selectedFile = fileInput.files[0];

        if (!selectedFile) {
            uploadedImage = null;
            showEmptyUploadCard();
            updateStyleButtonState();
            return;
        }

        const image = new Image();

        image.onload = function () {
            uploadedImage = image;
            guides = [];
            selectedGuideId = null;
            nextGuideId = 1;
            lastSavedTemplate = null;
            undoStack = [];
            tapInstructionText = "Tap the center of a nail to start.";
            maskInput.value = "";
            updateImageDependentSliderRanges();
            updateSavedCount();
            updateUndoButton();
            updateStyleButtonState();
            resizeCanvas();
            viewFullHand();
        };

        if (imageObjectUrl) {
            URL.revokeObjectURL(imageObjectUrl);
        }

        imageObjectUrl = URL.createObjectURL(selectedFile);
        showUploadPreview(imageObjectUrl);
        image.src = imageObjectUrl;
    });

    changePhotoButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        fileInput.click();
    });

    ["dragenter", "dragover"].forEach((eventName) => {
        uploadBox.addEventListener(eventName, function (event) {
            event.preventDefault();
            uploadBox.classList.add("is-dragging");
        });
    });

    ["dragleave", "drop"].forEach((eventName) => {
        uploadBox.addEventListener(eventName, function () {
            uploadBox.classList.remove("is-dragging");
        });
    });

    uploadBox.addEventListener("drop", handleDroppedFile);

    styleInputs.forEach((input) => {
        input.addEventListener("change", updateStyleButtonState);
    });
    updateStyleButtonState();

    [visibleShapeSelect, visibleRotationSlider, sizeSlider, sharpnessSlider].forEach((control) => {
        control.addEventListener("pointerdown", function () {
            if (selectedGuide()) {
                rememberUndoState();
            }
        });
        control.addEventListener("input", updateSelectedGuideFromFineControls);
        control.addEventListener("change", updateSelectedGuideFromFineControls);
    });
    shapePickerTrigger.addEventListener("click", toggleShapePicker);
    shapeChoiceButtons.forEach((button) => {
        button.addEventListener("click", function () {
            if (visibleShapeSelect.value === button.dataset.shape) {
                closeShapePicker();
                return;
            }

            if (selectedGuide()) {
                rememberUndoState();
            }

            visibleShapeSelect.value = button.dataset.shape;
            updateShapeChoiceButtons(visibleShapeSelect.value);
            updateSelectedGuideFromFineControls({ target: visibleShapeSelect });
            closeShapePicker();
        });
    });
    document.addEventListener("click", function (event) {
        if (shapeChoicePanel.hidden) {
            return;
        }

        if (shapeChoicePanel.contains(event.target) || shapePickerTrigger.contains(event.target)) {
            return;
        }

        closeShapePicker();
    });
    symmetryToggleButton.addEventListener("click", toggleSymmetry);
    undoButton.addEventListener("click", undoLastEditorChange);
    updateSymmetryButton();
    updateUndoButton();
    updateShapeChoiceButtons(visibleShapeSelect.value);

    guideCanvas.addEventListener("pointerdown", handlePointerDown);
    guideCanvas.addEventListener("pointermove", handlePointerMove);
    guideCanvas.addEventListener("pointerup", stopPointer);
    guideCanvas.addEventListener("pointercancel", stopPointer);
    guideCanvas.addEventListener("pointerleave", stopPointer);
    guideCanvas.addEventListener("contextmenu", function (event) {
        event.preventDefault();
    });
    guideCanvas.addEventListener("selectstart", function (event) {
        event.preventDefault();
    });
    guideCanvas.addEventListener("dragstart", function (event) {
        event.preventDefault();
    });
    guideCanvas.addEventListener("dblclick", function (event) {
        event.preventDefault();
    });
    guideCanvas.addEventListener("wheel", function (event) {
        if (!uploadedImage) {
            return;
        }

        event.preventDefault();
        const canvasPoint = eventToCanvasPoint(event);
        const zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12;

        zoomAtCanvasPoint(scale * zoomFactor, canvasPoint);
        render();
    }, { passive: false });

    // Mobile browsers, especially iPhone Safari, can start page zoom before
    // pointer events fully take over. These raw touch guards prevent browser
    // pinch/double-tap zoom while the editor is open, without blocking our own
    // canvas pinch handler above.
    document.addEventListener("touchstart", function (event) {
        if (!document.body.classList.contains("editor-active")) {
            return;
        }

        if (event.touches.length > 1) {
            event.preventDefault();
        }
    }, { passive: false, capture: true });

    document.addEventListener("touchmove", function (event) {
        if (!document.body.classList.contains("editor-active")) {
            return;
        }

        if (event.touches.length > 1) {
            event.preventDefault();
        }
    }, { passive: false, capture: true });

    document.addEventListener("touchend", function (event) {
        if (!document.body.classList.contains("editor-active")) {
            return;
        }

        const now = Date.now();

        if (event.changedTouches.length === 1 && now - lastTapTime < 320) {
            event.preventDefault();
        }
    }, { passive: false, capture: true });

    ["gesturestart", "gesturechange", "gestureend"].forEach((eventName) => {
        document.addEventListener(eventName, function (event) {
            if (document.body.classList.contains("editor-active")) {
                event.preventDefault();
            }
        }, { passive: false });
    });
    document.addEventListener("wheel", function (event) {
        if (event.ctrlKey) {
            event.preventDefault();
        }
    }, { passive: false });

    goToStylesButton.addEventListener("click", function () {
        if (!uploadedImage) {
            return;
        }

        showStep("style");
    });

    goToMaskButton.addEventListener("click", function () {
        if (!uploadedImage || !selectedStyle()) {
            return;
        }

        showStep("mask");
    });

    backToUploadButton.addEventListener("click", function () {
        showStep("upload");
    });

    backToStylesButton.addEventListener("click", function () {
        showStep("style");
    });

    saveNailButton.addEventListener("click", saveSelectedGuide);
    deleteNailButton.addEventListener("click", deleteSelectedGuide);
    addNailButton.addEventListener("click", enterTapNextNailMode);
    viewFullButton.addEventListener("click", viewFullHand);
    topGenerateButton.addEventListener("click", function () {
        if (topGenerateButton.disabled) {
            return;
        }

        submitButton.click();
    });
    bottomGenerateButton.addEventListener("click", function () {
        if (bottomGenerateButton.disabled) {
            return;
        }

        submitButton.click();
    });

    window.addEventListener("resize", function () {
        resizeCanvas();
        render();
    });

    form.addEventListener("submit", function (event) {
        if (isSubmitting) {
            return;
        }

        event.preventDefault();

        if (!guides.some((guide) => guide.saved)) {
            alert("Please add at least one nail guide before generating.");
            showStep("mask");
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = "Preparing preview...";

        buildMaskCanvas().toBlob(function (maskBlob) {
            putMaskBlobIntoFileInput(maskBlob);
            isSubmitting = true;
            form.submit();
        }, "image/png");
    });
});
