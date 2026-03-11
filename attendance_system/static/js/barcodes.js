(function () {
    "use strict";

    const grid = document.getElementById("barcodes-grid");
    const btnGenerate = document.getElementById("btn-generate-all");
    const studentForm = document.getElementById("student-entry-form");
    const btnSaveStudent = document.getElementById("btn-save-student");
    const nameInput = document.getElementById("student-name-input");
    const regInput = document.getElementById("student-reg-input");
    const classInput = document.getElementById("student-class-input");
    const barcodeFileInput = document.getElementById("student-barcode-file");
    const barcodePreview = document.getElementById("barcode-image-preview");
    const barcodeStatus = document.getElementById("barcode-upload-status");
    const decodedBarcodeValue = document.getElementById("decoded-barcode-value");
    const loading = document.getElementById("loading-indicator");
    const toastContainer = document.getElementById("toast-container");

    const barcodeReaderElementId = "barcode-file-reader";
    const COURSE_OPTIONS = [
        "B.Sc. CS",
        "B.Sc. CSDA",
        "B.com.",
        "B.com. CA",
        "B.com. PA",
        "B.com IT",
        "BBA CA",
        "B.Sc. CSHM",
        "B.Sc. IT",
    ];
    const saveButtonMarkup = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
        </svg>
        Save Student
    `;
    const ocrStopWords = [
        "SANKARA", "COLLEGE", "SCIENCE", "COMMERCE", "AUTONOMOUS", "STUDENT ID",
        "IDENTITY", "AFFILIATED", "AUTHORIZED", "GRADE", "INSTITUTION", "VALID",
        "BATCH", "BLOOD", "ISSUED", "CARD"
    ];
    const quaggaReaders = [
        "code_128_reader", "code_39_reader", "codabar_reader",
        "ean_reader", "ean_8_reader", "upc_reader", "upc_e_reader", "i2of5_reader"
    ];

    let barcodeImageUrl = "";
    let decodedBarcodeText = "";
    let barcodeReader = null;
    let barcodeDetectorPromise = null;
    let activeUploadId = 0;
    let isAnalyzingUpload = false;

    if (btnGenerate) btnGenerate.addEventListener("click", () => generateAll({ showToast: true }));
    studentForm.addEventListener("submit", saveStudent);
    studentForm.addEventListener("reset", resetCardProcessingState);
    barcodeFileInput.addEventListener("change", handleIdCardUpload);
    document.addEventListener("DOMContentLoaded", () => generateAll({ showToast: false }));

    async function generateAll(options = {}) {
        const showToastMessage = Boolean(options.showToast);
        loading.style.display = "inline";
        if (btnGenerate) btnGenerate.disabled = true;
        try {
            const res = await fetch("/api/generate-all-barcodes");
            const data = await res.json();
            if (data.error) {
                showToast(data.error, "error");
                return;
            }
            grid.innerHTML = "";
            data.students.forEach((student, index) => {
                const badgeLabel = student.department || student.class || "Student";
                const barcodeMeta = student.barcode_value && student.barcode_value !== student.reg_no
                    ? `<span class="barcode-meta">Barcode: ${escapeHtml(student.barcode_value)}</span>`
                    : "";
                const card = document.createElement("div");
                card.className = "barcode-card glass-card";
                card.style.animation = `fadeInUp 0.3s ease ${index * 0.05}s both`;
                card.innerHTML = `
                    <div class="barcode-card-header">
                        <strong>${escapeHtml(student.name)}</strong>
                        <span class="badge badge-dept">${escapeHtml(badgeLabel)}</span>
                    </div>
                    <img src="${student.barcode_url}" alt="Barcode for ${escapeHtml(student.reg_no)}" class="barcode-img">
                    <span class="barcode-reg">RegNo: ${escapeHtml(student.reg_no)}</span>
                    ${barcodeMeta}
                `;
                grid.appendChild(card);
            });
            if (showToastMessage) {
                showToast(`Loaded ${data.students.length} barcodes.`, "success");
            }
        } catch (err) {
            showToast("Failed to generate barcodes.", "error");
        } finally {
            loading.style.display = "none";
            if (btnGenerate) btnGenerate.disabled = false;
        }
    }

    async function handleIdCardUpload() {
        const file = barcodeFileInput.files[0];
        const uploadId = ++activeUploadId;
        const existingFields = {
            name: nameInput.value.trim(),
            reg_no: regInput.value.trim(),
            class: classInput.value.trim(),
        };
        decodedBarcodeText = "";
        decodedBarcodeValue.textContent = "Waiting for image";
        renderBarcodeUploadState("Upload a student ID card or barcode strip to auto-detect the details.", "idle");

        if (!file) {
            clearBarcodePreview();
            return;
        }

        isAnalyzingUpload = true;
        updateBarcodePreview(file);
        decodedBarcodeValue.textContent = "Detecting...";
        renderBarcodeUploadState("Analyzing image and trying barcode recovery...", "loading");

        try {
            const image = await loadImageFromFile(file);
            const extractedFields = await extractStudentFieldsFromImage(image).catch(() => ({ name: "", reg_no: "", class: "" }));
            const barcodeResult = await decodeBarcodeFromImage(file, image, extractedFields.reg_no).catch(() => ({ value: "", method: "", label: "" }));

            if (uploadId !== activeUploadId) return;

            decodedBarcodeText = barcodeResult.value || "";
            decodedBarcodeValue.textContent = decodedBarcodeText || "Not detected";
            applyExtractedFields(extractedFields, existingFields);

            const payload = buildStudentPayload();
            const detectedCount = countRequiredFields(payload);
            const missingFields = getMissingFields(payload);

            if (detectedCount === 4 && barcodeResult.method !== "regno-fallback") {
                renderBarcodeUploadState(`Student details detected${barcodeResult.label ? ` using ${barcodeResult.label}` : ""}. Saving to database...`, "loading");
                const saved = await persistStudentRecord(payload, {
                    successMessage: "Student ID card detected and saved.",
                    autoTriggered: true,
                });
                if (!saved) renderBarcodeUploadState("Details were detected, but saving failed. Review the fields and try Save Student.", "error");
                return;
            }

            if (decodedBarcodeText && barcodeResult.method === "regno-fallback") {
                renderBarcodeUploadState("Barcode bars were unclear. Using the detected RegNo as a fallback. Review the data and click Save Student.", "success");
            } else if (decodedBarcodeText && missingFields.length) {
                renderBarcodeUploadState(`Barcode recovered${barcodeResult.label ? ` with ${barcodeResult.label}` : ""}. Complete ${missingFields.join(", ")} and click Save Student.`, "success");
            } else if (decodedBarcodeText) {
                renderBarcodeUploadState(`Barcode recovered${barcodeResult.label ? ` using ${barcodeResult.label}` : ""}. Review the data and click Save Student.`, "success");
            } else if (detectedCount > 0) {
                renderBarcodeUploadState(`Detected ${detectedCount}/4 required fields. Barcode is still unreadable. Try a flatter image or a tighter barcode crop.`, "error");
            } else {
                renderBarcodeUploadState("Could not read the image. Try a brighter, flatter photo or crop closer to the barcode.", "error");
            }
        } catch (err) {
            if (uploadId !== activeUploadId) return;
            decodedBarcodeText = "";
            decodedBarcodeValue.textContent = "Not detected";
            renderBarcodeUploadState(err.message || "Could not process the image.", "error");
            showToast(err.message || "Could not process the image.", "error");
        } finally {
            if (uploadId === activeUploadId) isAnalyzingUpload = false;
        }
    }

    async function saveStudent(event) {
        event.preventDefault();
        if (isAnalyzingUpload) {
            showToast("Wait until image analysis finishes before saving.", "error");
            return;
        }

        const payload = buildStudentPayload();
        if (!payload.barcode) {
            try {
                payload.barcode = await ensureBarcodeDecoded();
            } catch (err) {
                showToast(err.message || "Upload a readable student ID card image.", "error");
                return;
            }
        }

        await persistStudentRecord(payload, {
            successMessage: "Student added successfully.",
            autoTriggered: false,
        });
    }

    async function persistStudentRecord(payload, options = {}) {
        const successMessage = options.successMessage || "Student added successfully.";
        const autoTriggered = Boolean(options.autoTriggered);

        if (!payload.name || !payload.reg_no || !payload.class || !payload.barcode) {
            showToast("Name, RegNo, Course, and barcode are required before saving.", "error");
            return false;
        }

        btnSaveStudent.disabled = true;
        btnSaveStudent.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="animation: pulse 1s infinite;">
                <circle cx="12" cy="12" r="10" />
            </svg>
            ${autoTriggered ? "Saving Auto Fill..." : "Saving..."}
        `;

        try {
            const res = await fetch("/api/students", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await res.json();

            if (!res.ok) {
                showToast(data.error || "Failed to save student data.", "error");
                return false;
            }

            showToast(successMessage, "success");
            studentForm.reset();
            await generateAll({ showToast: false });
            nameInput.focus();
            return true;
        } catch (err) {
            showToast("Network error. Could not save student data.", "error");
            return false;
        } finally {
            renderSaveButtonIdle();
        }
    }

    function buildStudentPayload() {
        const selectedCourse = classInput.value.trim();
        return {
            name: nameInput.value.trim(),
            reg_no: regInput.value.trim(),
            department: selectedCourse,
            class: selectedCourse,
            barcode: decodedBarcodeText.trim(),
        };
    }

    function countRequiredFields(payload) {
        return [payload.name, payload.reg_no, payload.class, payload.barcode].filter(Boolean).length;
    }

    function getMissingFields(payload) {
        const missing = [];
        if (!payload.name) missing.push("Name");
        if (!payload.reg_no) missing.push("RegNo");
        if (!payload.class) missing.push("Course");
        if (!payload.barcode) missing.push("Barcode");
        return missing;
    }

    function applyExtractedFields(extractedFields, fallbackFields = {}) {
        const resolvedCourse = normalizeCourseValue(extractedFields.class) || normalizeCourseValue(fallbackFields.class);
        nameInput.value = extractedFields.name || fallbackFields.name || "";
        regInput.value = extractedFields.reg_no || fallbackFields.reg_no || "";
        classInput.value = resolvedCourse || "";
    }

    function clearDetectedFields() {
        nameInput.value = "";
        regInput.value = "";
        classInput.value = "";
    }

    function renderSaveButtonIdle() {
        btnSaveStudent.disabled = false;
        btnSaveStudent.innerHTML = saveButtonMarkup;
    }

    function renderBarcodeUploadState(message, state) {
        barcodeStatus.textContent = message;
        barcodeStatus.className = `barcode-upload-status barcode-upload-status-${state}`;
    }

    function updateBarcodePreview(file) {
        clearBarcodePreview();
        barcodeImageUrl = URL.createObjectURL(file);
        barcodePreview.innerHTML = `<img src="${barcodeImageUrl}" alt="Selected student ID card" class="barcode-preview-image">`;
    }

    function clearBarcodePreview() {
        if (barcodeImageUrl) {
            URL.revokeObjectURL(barcodeImageUrl);
            barcodeImageUrl = "";
        }
        barcodePreview.textContent = "No image selected";
    }

    function resetCardProcessingState() {
        activeUploadId += 1;
        isAnalyzingUpload = false;
        decodedBarcodeText = "";
        clearDetectedFields();
        decodedBarcodeValue.textContent = "Waiting for image";
        renderBarcodeUploadState("Upload a student ID card or barcode strip to auto-detect the details.", "idle");
        renderSaveButtonIdle();
        setTimeout(clearBarcodePreview, 0);
    }

    async function ensureBarcodeDecoded() {
        const file = barcodeFileInput.files[0];
        if (!file) throw new Error("Upload a student ID card or barcode strip before saving.");
        if (decodedBarcodeText) return decodedBarcodeText;

        decodedBarcodeValue.textContent = "Detecting...";
        renderBarcodeUploadState("Trying advanced barcode recovery...", "loading");

        const image = await loadImageFromFile(file);
        const barcodeResult = await decodeBarcodeFromImage(file, image, regInput.value.trim());
        decodedBarcodeText = barcodeResult.value || "";
        decodedBarcodeValue.textContent = decodedBarcodeText || "Not detected";

        if (!decodedBarcodeText) throw new Error("Could not detect a barcode from the uploaded image.");

        if (barcodeResult.method === "regno-fallback") {
            renderBarcodeUploadState("Barcode bars were unclear. Using the detected RegNo as a fallback. Review the data and save.", "success");
        } else {
            renderBarcodeUploadState(`Barcode detected${barcodeResult.label ? ` using ${barcodeResult.label}` : ""}. Review the fields and save.`, "success");
        }

        return decodedBarcodeText;
    }

    async function decodeBarcodeFromImage(file, image, regNoHint) {
        const candidates = await buildBarcodeCandidates(image);

        let value = await detectWithBarcodeDetector(candidates);
        if (value) return { value, method: "barcode-detector", label: "browser detector" };

        value = await detectWithQuagga(candidates);
        if (value) return { value, method: "quagga", label: "advanced recovery" };

        value = await detectWithHtml5Qrcode(file, candidates);
        if (value) return { value, method: "html5-qrcode", label: "file scan" };

        value = await recoverBarcodeFromText(candidates, regNoHint);
        if (value) return { value, method: "ocr", label: "printed text OCR" };

        value = normalizeRegNoFallback(regNoHint);
        if (value) return { value, method: "regno-fallback", label: "RegNo fallback" };

        throw new Error("Could not detect a barcode. Try a clearer ID card image.");
    }

    async function buildBarcodeCandidates(image) {
        const ratio = image.naturalWidth / Math.max(image.naturalHeight, 1);
        const isStrip = ratio >= 2.15;
        const baseVariants = isStrip ? [
            { key: "full", x: 0, y: 0, w: 1, h: 1, scale: 4.5, pad: 48, mode: "normal", locate: false, textOcr: true, priority: 14 },
            { key: "full-contrast", x: 0, y: 0, w: 1, h: 1, scale: 5.2, pad: 56, mode: "contrast", locate: false, textOcr: true, priority: 16 },
            { key: "full-threshold", x: 0, y: 0.08, w: 1, h: 0.84, scale: 6, pad: 64, mode: "threshold", locate: false, textOcr: true, priority: 20, rotations: [0, -2, 2] },
            { key: "full-sharpen", x: 0, y: 0.08, w: 1, h: 0.84, scale: 5.8, pad: 62, mode: "sharpen", locate: false, textOcr: true, priority: 18, rotations: [0, -2, 2] },
            { key: "tight-threshold", x: 0.02, y: 0.18, w: 0.96, h: 0.64, scale: 6.4, stretchX: 1.8, pad: 72, mode: "contrast-threshold", locate: false, textOcr: true, priority: 24, rotations: [0, -2, 2, -4, 4] },
            { key: "tight-invert", x: 0.02, y: 0.18, w: 0.96, h: 0.64, scale: 6.4, stretchX: 1.8, pad: 72, mode: "invert-threshold", locate: false, textOcr: true, priority: 22, rotations: [0, -2, 2] },
        ] : [
            { key: "full", x: 0, y: 0, w: 1, h: 1, scale: 2.2, pad: 28, mode: "normal", locate: true, textOcr: true, priority: 10 },
            { key: "full-contrast", x: 0, y: 0, w: 1, h: 1, scale: 2.8, pad: 32, mode: "contrast", locate: true, textOcr: true, priority: 12 },
            { key: "lower-half", x: 0.03, y: 0.48, w: 0.94, h: 0.46, scale: 3.2, pad: 40, mode: "normal", locate: true, textOcr: false, priority: 15 },
            { key: "lower-half-threshold", x: 0.03, y: 0.48, w: 0.94, h: 0.46, scale: 3.8, pad: 46, mode: "contrast-threshold", locate: true, textOcr: false, priority: 17 },
            { key: "barcode-band", x: 0.05, y: 0.64, w: 0.9, h: 0.22, scale: 5.2, stretchX: 1.5, pad: 64, mode: "normal", locate: false, textOcr: true, priority: 19, rotations: [0, -2, 2] },
            { key: "barcode-band-threshold", x: 0.05, y: 0.64, w: 0.9, h: 0.22, scale: 5.8, stretchX: 1.7, pad: 72, mode: "contrast-threshold", locate: false, textOcr: true, priority: 23, rotations: [0, -2, 2] },
            { key: "barcode-with-text", x: 0.05, y: 0.61, w: 0.9, h: 0.28, scale: 5, stretchX: 1.45, pad: 68, mode: "sharpen", locate: false, textOcr: true, priority: 21, rotations: [0, -2, 2] },
        ];

        const variants = baseVariants.flatMap((variant) => {
            const rotations = Array.isArray(variant.rotations) ? variant.rotations : [0];
            return rotations.map((rotate) => ({
                ...variant,
                rotate,
                key: rotate ? `${variant.key}-r${String(rotate).replace("-", "n")}` : variant.key,
            }));
        });

        return Promise.all(variants.map(async (variant) => {
            const canvas = createVariantCanvas(image, variant);
            return {
                key: variant.key,
                canvas,
                file: await canvasToFile(canvas, variant.key),
                dataUrl: canvas.toDataURL("image/png"),
                locate: Boolean(variant.locate),
                textOcr: Boolean(variant.textOcr),
                priority: variant.priority || 0,
            };
        }));
    }

    function createVariantCanvas(image, variant) {
        const sourceX = clamp(Math.floor(image.naturalWidth * (variant.x || 0)), 0, image.naturalWidth - 1);
        const sourceY = clamp(Math.floor(image.naturalHeight * (variant.y || 0)), 0, image.naturalHeight - 1);
        const sourceWidth = Math.min(Math.max(1, Math.floor(image.naturalWidth * (variant.w || 1))), image.naturalWidth - sourceX);
        const sourceHeight = Math.min(Math.max(1, Math.floor(image.naturalHeight * (variant.h || 1))), image.naturalHeight - sourceY);
        const scale = variant.scale || 1;
        const stretchX = variant.stretchX || 1;

        let canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(sourceWidth * scale * stretchX));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);

        if (variant.mode && variant.mode !== "normal") applyCanvasMode(canvas, variant.mode);
        if (variant.rotate) canvas = rotateCanvas(canvas, variant.rotate);
        if (variant.pad) canvas = addCanvasPadding(canvas, variant.pad);
        return canvas;
    }

    function applyCanvasMode(canvas, mode) {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const gray = new Float32Array(canvas.width * canvas.height);

        for (let i = 0, g = 0; i < data.length; i += 4, g += 1) {
            gray[g] = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
        }

        const source = mode === "sharpen" ? sharpenGray(gray, canvas.width, canvas.height) : gray;
        for (let i = 0, g = 0; i < data.length; i += 4, g += 1) {
            let value = source[g];
            if (mode === "contrast" || mode === "contrast-threshold") value = clamp(((value - 128) * 2.6) + 128, 0, 255);
            if (mode === "sharpen") value = clamp((value * 1.2) + 6, 0, 255);
            if (mode === "threshold") value = value > 145 ? 255 : 0;
            else if (mode === "contrast-threshold") value = value > 150 ? 255 : 0;
            else if (mode === "invert-threshold") value = value > 168 ? 0 : 255;
            data[i] = value;
            data[i + 1] = value;
            data[i + 2] = value;
        }

        ctx.putImageData(imageData, 0, 0);
    }

    function sharpenGray(input, width, height) {
        const output = new Float32Array(input.length);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const index = (y * width) + x;
                if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
                    output[index] = input[index];
                    continue;
                }
                output[index] = (5 * input[index]) - input[index - 1] - input[index + 1] - input[index - width] - input[index + width];
            }
        }
        return output;
    }

    function rotateCanvas(sourceCanvas, angle) {
        const radians = angle * Math.PI / 180;
        const sin = Math.abs(Math.sin(radians));
        const cos = Math.abs(Math.cos(radians));
        const width = sourceCanvas.width;
        const height = sourceCanvas.height;
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil((width * cos) + (height * sin));
        canvas.height = Math.ceil((width * sin) + (height * cos));
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(radians);
        ctx.drawImage(sourceCanvas, -width / 2, -height / 2);
        return canvas;
    }

    function addCanvasPadding(sourceCanvas, pad) {
        const canvas = document.createElement("canvas");
        canvas.width = sourceCanvas.width + (pad * 2);
        canvas.height = sourceCanvas.height + (pad * 2);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(sourceCanvas, pad, pad);
        return canvas;
    }

    function canvasToFile(canvas, name) {
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error("Could not prepare the image for scanning."));
                    return;
                }
                resolve(new File([blob], `${name}.png`, { type: "image/png" }));
            }, "image/png");
        });
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, Math.round(value)));
    }

    async function getBarcodeDetector() {
        if (!("BarcodeDetector" in window)) return null;
        if (!barcodeDetectorPromise) {
            barcodeDetectorPromise = (async () => {
                try {
                    const preferred = ["code_128", "code_39", "codabar", "ean_13", "ean_8", "itf", "upc_a", "upc_e"];
                    if (typeof window.BarcodeDetector.getSupportedFormats === "function") {
                        const supported = await window.BarcodeDetector.getSupportedFormats();
                        const formats = preferred.filter((format) => supported.includes(format));
                        return formats.length ? new window.BarcodeDetector({ formats }) : null;
                    }
                    return new window.BarcodeDetector({ formats: preferred });
                } catch (err) {
                    return null;
                }
            })();
        }
        return barcodeDetectorPromise;
    }

    async function detectWithBarcodeDetector(candidates) {
        const detector = await getBarcodeDetector();
        if (!detector) return "";
        for (const candidate of sortByPriority(candidates)) {
            try {
                const results = await detector.detect(candidate.canvas);
                const match = Array.isArray(results) ? results.find((item) => sanitizeBarcodeValue(item.rawValue || "")) : null;
                if (match) return sanitizeBarcodeValue(match.rawValue);
            } catch (err) {
                // Try the next candidate.
            }
        }
        return "";
    }

    async function detectWithQuagga(candidates) {
        if (typeof Quagga === "undefined" || typeof Quagga.decodeSingle !== "function") return "";
        for (const candidate of sortByPriority(candidates).slice(0, 12)) {
            let value = await decodeSingleWithQuagga(candidate.dataUrl, candidate.locate);
            if (value) return value;
            value = await decodeSingleWithQuagga(candidate.dataUrl, !candidate.locate);
            if (value) return value;
        }
        return "";
    }

    function decodeSingleWithQuagga(src, locate) {
        return new Promise((resolve) => {
            Quagga.decodeSingle({
                src,
                numOfWorkers: 0,
                locate,
                inputStream: { size: 1800, singleChannel: false },
                locator: { halfSample: false, patchSize: locate ? "medium" : "small" },
                decoder: { readers: quaggaReaders, multiple: false },
            }, (result) => resolve(sanitizeBarcodeValue(result?.codeResult?.code || "")));
        });
    }

    async function detectWithHtml5Qrcode(originalFile, candidates) {
        if (typeof Html5Qrcode === "undefined") return "";
        if (!barcodeReader) barcodeReader = new Html5Qrcode(barcodeReaderElementId);

        const filesToTry = [originalFile, ...sortByPriority(candidates).slice(0, 8).map((candidate) => candidate.file)];
        for (const file of filesToTry) {
            try {
                const value = sanitizeBarcodeValue(await barcodeReader.scanFile(file, true));
                if (value) return value;
            } catch (err) {
                // Try the next candidate.
            } finally {
                try {
                    await barcodeReader.clear();
                } catch (clearErr) {
                    // Ignore hidden-reader cleanup errors.
                }
            }
        }
        return "";
    }

    async function recoverBarcodeFromText(candidates, regNoHint) {
        if (typeof Tesseract === "undefined") return "";
        const hint = normalizeToken(regNoHint);
        let best = { value: "", score: Number.NEGATIVE_INFINITY };

        for (const candidate of sortByPriority(candidates).filter((item) => item.textOcr).slice(0, 8)) {
            try {
                const text = await recognizeTextFromCanvas(candidate.canvas, { barcodeLine: true });
                const value = pickBestBarcodeToken(text, hint);
                if (!value) continue;
                const score = scoreBarcodeToken(value, hint);
                if (score > best.score) best = { value, score };
                if (hint && normalizeToken(value) === hint) return value;
                if (score >= 18) return value;
            } catch (err) {
                // Try the next OCR candidate.
            }
        }

        return best.value;
    }

    async function extractStudentFieldsFromImage(image) {
        if (typeof Tesseract === "undefined") return { name: "", reg_no: "", class: "" };

        const variants = [
            createVariantCanvas(image, { x: 0, y: 0, w: 1, h: 1, scale: 2, mode: "normal" }),
            createVariantCanvas(image, { x: 0, y: 0, w: 1, h: 1, scale: 2.5, mode: "contrast" }),
            createVariantCanvas(image, { x: 0.08, y: 0.2, w: 0.84, h: 0.55, scale: 3, mode: "contrast" }),
            createVariantCanvas(image, { x: 0.08, y: 0.18, w: 0.84, h: 0.6, scale: 3.2, mode: "sharpen" }),
        ];

        let best = { name: "", reg_no: "", class: "", score: 0 };
        for (const canvas of variants) {
            try {
                const parsed = parseStudentCardText(await recognizeTextFromCanvas(canvas));
                const score = scoreParsedFields(parsed);
                if (score > best.score) best = { ...parsed, score };
                if (score >= 3) break;
            } catch (err) {
                // Try the next OCR variant.
            }
        }

        return best;
    }

    async function recognizeTextFromCanvas(canvas, options = {}) {
        const result = await Tesseract.recognize(canvas, "eng", {
            logger: () => { },
            tessedit_pageseg_mode: options.barcodeLine ? "7" : undefined,
            tessedit_char_whitelist: options.barcodeLine ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789./-" : undefined,
        });
        return String(result?.data?.text || "");
    }

    function parseStudentCardText(text) {
        const lines = String(text || "").replace(/\r/g, "").split("\n").map(cleanOcrLine).filter(Boolean);
        return {
            name: extractStudentName(lines),
            reg_no: extractStudentRegNo(lines),
            class: normalizeCourseValue(extractStudentClass(lines)),
        };
    }

    function normalizeCourseValue(value) {
        const source = String(value || "").trim();
        if (!source) return "";

        const normalized = source.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const exactMatch = COURSE_OPTIONS.find((course) => course.toUpperCase().replace(/[^A-Z0-9]/g, "") === normalized);
        if (exactMatch) return exactMatch;

        const matchers = [
            { course: "B.Sc. CSDA", patterns: [/CSDA/, /CS&DA/, /DATA\s*ANALYTICS/, /DATA\s*SCIENCE/, /\bBDA\b/] },
            { course: "B.Sc. CSHM", patterns: [/CSHM/, /HOTEL\s*MANAGEMENT/, /CATERING/] },
            { course: "B.com. CA", patterns: [/B\.?\s*COM\.?\s*CA/, /\bBCOMCA\b/] },
            { course: "B.com. PA", patterns: [/B\.?\s*COM\.?\s*PA/, /\bBCOMPA\b/] },
            { course: "B.com IT", patterns: [/B\.?\s*COM\.?\s*IT/, /\bBCOMIT\b/] },
            { course: "BBA CA", patterns: [/\bBBA\s*CA\b/, /\bBBACA\b/] },
            { course: "B.Sc. IT", patterns: [/B\.?\s*SC\.?\s*IT/, /\bBSCIT\b/, /INFORMATION\s*TECHNOLOGY/] },
            { course: "B.Sc. CS", patterns: [/B\.?\s*SC\.?\s*CS\b/, /\bBSCCS\b/, /COMPUTER\s*SCIENCE/] },
            { course: "B.com.", patterns: [/\bB\.?\s*COM\b/, /\bBCOM\b/, /COMMERCE/] },
        ];

        const upper = source.toUpperCase();
        const matched = matchers.find((item) => item.patterns.some((pattern) => pattern.test(upper)));
        return matched ? matched.course : "";
    }

    function cleanOcrLine(line) {
        return String(line || "").replace(/[|]/g, "I").replace(/[`~_]/g, " ").replace(/\s+/g, " ").trim();
    }

    function extractStudentRegNo(lines) {
        const keywordPattern = /(REG|REGISTER|ROLL|ADM|ADMN|STUDENT NO|NO\.|ID NO|IDNO)/i;
        for (const line of lines) {
            if (keywordPattern.test(line)) {
                const token = pickBestRegToken(line);
                if (token) return token;
            }
        }
        for (const line of lines) {
            const token = pickBestRegToken(line);
            if (token) return token;
        }
        return "";
    }

    function pickBestRegToken(line) {
        const tokens = String(line || "").toUpperCase().match(/[A-Z0-9]{5,18}/g) || [];
        return tokens
            .filter((token) => /[A-Z]/.test(token) && /\d/.test(token))
            .filter((token) => !/^20\d{2}$/.test(token))
            .filter((token) => token.length >= 6)
            .sort((left, right) => scoreRegToken(right) - scoreRegToken(left))[0] || "";
    }

    function scoreRegToken(token) {
        let score = token.length;
        if (/^[0-9]{2,4}[A-Z]{1,8}[0-9]{2,8}$/.test(token)) score += 6;
        if (token.length <= 10) score += 2;
        return score;
    }

    function extractStudentClass(lines) {
        for (const line of lines) {
            const value = normalizeCourseValue(line);
            if (value) return value;
        }
        const keywordPattern = /(CLASS|COURSE|DEPARTMENT|DEPT|PROGRAM|YEAR|SEM|SECTION|BATCH)/i;
        for (const line of lines) {
            if (keywordPattern.test(line)) {
                const value = extractClassFromKeywordLine(line);
                if (value) return value;
            }
        }
        const candidate = lines
            .map((line) => ({ line, score: scoreClassLine(line) }))
            .filter((item) => item.score > 0)
            .sort((left, right) => right.score - left.score)[0];
        return candidate ? cleanupClassValue(candidate.line) : "";
    }

    function extractClassFromKeywordLine(line) {
        const parts = line
            .split(/(?:CLASS|COURSE|DEPARTMENT|DEPT|PROGRAM|YEAR|SEM|SECTION|BATCH)\s*[:\-]?\s*/i)
            .map(cleanupClassValue)
            .filter(Boolean);

        for (const part of parts) {
            const value = normalizeCourseValue(part);
            if (value) return value;
        }

        return parts.sort((left, right) => scoreClassLine(right) - scoreClassLine(left))[0] || "";
    }

    function cleanupClassValue(value) {
        const cleaned = String(value || "")
            .replace(/\b(CLASS|COURSE|DEPARTMENT|DEPT|PROGRAM|YEAR|SEM|SECTION|BATCH)\b/ig, "")
            .replace(/\s+/g, " ")
            .trim();
        if (!cleaned || cleaned.length > 36) return "";
        if (ocrStopWords.some((word) => cleaned.toUpperCase().includes(word))) return "";
        return cleaned;
    }

    function scoreClassLine(line) {
        const upper = String(line || "").toUpperCase();
        if (normalizeCourseValue(upper)) return 10;
        if (ocrStopWords.some((word) => upper.includes(word))) return -1;
        if (upper.length < 3 || upper.length > 36) return -1;
        let score = 0;
        if (/(BSC|B\.SC|BBA|BCOM|B\.COM|CA|PA|IT|CSHM|CSDA|COMPUTER SCIENCE|COMMERCE)/.test(upper)) score += 5;
        if (/(YEAR|SEM|SECTION|COURSE|CLASS|DEPT|DEPARTMENT|PROGRAM)/.test(upper)) score += 4;
        if (/[A-Z]/.test(upper)) score += 2;
        return score;
    }

    function extractStudentName(lines) {
        for (const line of lines) {
            if (/(STUDENT NAME|NAME)/i.test(line)) {
                const cleaned = line.replace(/.*?(STUDENT NAME|NAME)\s*[:\-]?\s*/i, "").trim();
                if (scoreNameLine(cleaned) > 0) return cleaned;
            }
        }
        const candidate = lines
            .map((line) => ({ line, score: scoreNameLine(line) }))
            .filter((item) => item.score > 0)
            .sort((left, right) => right.score - left.score)[0];
        return candidate ? candidate.line : "";
    }

    function scoreNameLine(line) {
        const upper = String(line || "").toUpperCase().trim();
        const lettersOnly = upper.replace(/[^A-Z]/g, "");
        if (lettersOnly.length < 4 || upper.length > 32 || /[0-9]/.test(upper)) return -1;
        if (ocrStopWords.some((word) => upper.includes(word))) return -1;
        if (/(CLASS|COURSE|BATCH|DEPT|DEPARTMENT|PROGRAM|YEAR|SEM)/.test(upper)) return -1;
        let score = lettersOnly.length;
        if (/^[A-Z .]+$/.test(upper)) score += 4;
        if (upper.includes(".")) score += 2;
        if (upper.split(" ").length <= 4) score += 1;
        if (lettersOnly.length > 22) score -= 2;
        return score;
    }

    function scoreParsedFields(parsed) {
        return Number(Boolean(parsed.name)) + Number(Boolean(parsed.reg_no)) + Number(Boolean(parsed.class));
    }

    function pickBestBarcodeToken(text, hint) {
        const tokens = String(text || "").toUpperCase().match(/[A-Z0-9./-]{4,24}/g) || [];
        return tokens
            .map(cleanBarcodeToken)
            .filter(Boolean)
            .sort((left, right) => scoreBarcodeToken(right, hint) - scoreBarcodeToken(left, hint))[0] || "";
    }

    function scoreBarcodeToken(token, hint) {
        const normalized = normalizeToken(token);
        if (!normalized || normalized.length < 6) return Number.NEGATIVE_INFINITY;
        let score = token.length;
        if (/[A-Z]/.test(token) && /\d/.test(token)) score += 6;
        if (/^[0-9]{2,4}[A-Z]{1,8}[0-9]{2,8}$/.test(normalized)) score += 8;
        if (hint) {
            if (normalized === hint) score += 25;
            else if (normalized.includes(hint) || hint.includes(normalized)) score += 8;
        }
        return score;
    }

    function normalizeRegNoFallback(value) {
        const cleaned = cleanBarcodeToken(value);
        return looksLikeBarcode(cleaned) ? cleaned : "";
    }

    function sanitizeBarcodeValue(value) {
        const cleaned = cleanBarcodeToken(value).replace(/\s+/g, "");
        return looksLikeBarcode(cleaned) ? cleaned : "";
    }

    function cleanBarcodeToken(value) {
        return String(value || "").toUpperCase().replace(/[^A-Z0-9./-]/g, "").replace(/^\.+|\.+$/g, "").trim();
    }

    function normalizeToken(value) {
        return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    }

    function looksLikeBarcode(value) {
        const normalized = normalizeToken(value);
        return normalized.length >= 6 && (/\d/.test(normalized) || /[A-Z]/.test(normalized));
    }

    function sortByPriority(candidates) {
        return [...candidates].sort((left, right) => (right.priority || 0) - (left.priority || 0));
    }

    function loadImageFromFile(file) {
        return new Promise((resolve, reject) => {
            const objectUrl = URL.createObjectURL(file);
            const image = new Image();
            image.onload = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(image);
            };
            image.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error("Could not read the uploaded image."));
            };
            image.src = objectUrl;
        });
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function showToast(message, type) {
        const icons = {
            success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toast-icon"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
            error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toast-icon"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
        };
        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `${icons[type] || icons.success}<span>${escapeHtml(message)}</span>
            <button class="toast-close" onclick="this.parentElement.remove()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>`;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.classList.add("fade-out");
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }
})();
