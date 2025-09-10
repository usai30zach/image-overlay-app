import { useState, useRef } from "react";
import jsPDF from "jspdf";
import { Cropper } from "react-cropper";
import type { ReactCropperElement } from "react-cropper";
import "cropperjs/dist/cropper.css";

type Entry = {
  title: string | null;
  size: string | null;
  image: string | null;                 // cropped dataURL (JPEG/PNG)
  originalImage?: string | null;        // raw for Cropper
  orientation?: "auto" | "portrait" | "landscape";
  scale?: number;                       // 50..100 (%)
  offsetX?: number;                     // -100..100 (% from center)
  offsetY?: number;                     // -100..100 (% from center)
  rotation?: 0 | 90 | 180 | 270;        // manual rotation
};

// Backend base URL (TIFF -> PNG). On Netlify set VITE_API_BASE to your server URL.
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

// Crop export
const CROP_MAX_W = 4000;
const CROP_MAX_H = 4000;
const JPEG_QUALITY = 0.9;

// Panorama handling / insets
const PANORAMA_AR = 2.6;    // treat as panorama when width/height >= 2.6
const PANORAMA_INSET = 0.04;
const NORMAL_INSET = 0.10;

function App() {
  const [jobNumber, setJobNumber] = useState<string>("");

  const [entries, setEntries] = useState<Entry[]>([
    {
      title: "",
      size: "",
      image: null,
      originalImage: null,
      orientation: "auto",
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
    },
  ]);

  const [cropIndex, setCropIndex] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // upload spinner
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);

  const cropperRef = useRef<ReactCropperElement>(null);
  const previewRefs = useRef<(HTMLDivElement | null)[]>([]);

  // mutation-safe update
  const updateEntry = (index: number, field: keyof Entry, value: any) => {
    setEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, [field]: value } : e))
    );
  };

  const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    index: number
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();

    // TIFF → send to backend for conversion
    if (
      file.type === "image/tiff" ||
      fileName.endsWith(".tif") ||
      fileName.endsWith(".tiff")
    ) {
      const formData = new FormData();
      formData.append("file", file);

      try {
        setIsUploading(true);
        setUploadingIndex(index);

        // transparent preserves alpha; use ?bg=white if you want flattening instead
        const res = await fetch(`${API_BASE}/upload?bg=transparent`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Upload failed (${res.status}): ${text}`);
        }

        const data = await res.json();
        if (data.base64) {
          updateEntry(
            index,
            "originalImage",
            `data:image/png;base64,${data.base64}`
          );
          setCropIndex(index);
        } else {
          alert("TIFF conversion failed.");
        }
      } catch (err) {
        console.error("TIFF upload error:", err);
        alert("Error uploading TIFF image.");
      } finally {
        setIsUploading(false);
        setUploadingIndex(null);
      }
    } else {
      // non-TIFF → use object URL
      const url = URL.createObjectURL(file);
      updateEntry(index, "originalImage", url);
      setCropIndex(index);
    }
  };

  // export crop as JPEG (smaller PDF, still sharp)
  const applyCrop = () => {
    if (cropIndex === null || !cropperRef.current) return;
    const croppedCanvas = cropperRef.current?.cropper?.getCroppedCanvas({
      maxWidth: CROP_MAX_W,
      maxHeight: CROP_MAX_H,
      fillColor: "#ffffff",
    });
    if (!croppedCanvas) return;

    const dataUrl = croppedCanvas.toDataURL("image/jpeg", JPEG_QUALITY);
    updateEntry(cropIndex, "image", dataUrl);

    // clean up blob URL
    const orig = entries[cropIndex].originalImage;
    if (orig && orig.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(orig);
      } catch {}
    }

    updateEntry(cropIndex, "originalImage", null);
    setCropIndex(null);
  };

  const addEntry = () => {
    setEntries((prev) => [
      ...prev,
      {
        title: "",
        size: "",
        image: null,
        originalImage: null,
        orientation: "auto",
        scale: 100,
        offsetX: 0,
        offsetY: 0,
        rotation: 0,
      },
    ]);
  };

  const deleteEntry = (index: number) => {
    const orig = entries[index]?.originalImage;
    if (orig && orig.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(orig);
      } catch {}
    }
    setEntries((prev) => prev.filter((_, i) => i !== index));
  };


  // ---- helper: rotate image pixels to match page orientation (+ user rotation) ----
async function drawRotated(
  src: string,
  userRot: 0 | 90 | 180 | 270,
  pageOrientation: "portrait" | "landscape",
  jpegQuality = JPEG_QUALITY
): Promise<{ url: string; w: number; h: number; ar: number }> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });

  const baseW = img.naturalWidth;
  const baseH = img.naturalHeight;
  const baseAR = baseW / baseH;
  const norm = (d: number) => ((d % 360) + 360) % 360 as 0 | 90 | 180 | 270;
  const swap = (r: number) => r === 90 || r === 270;

  // choose a rotation so final pixels match page orientation + userRot
  let rot = userRot;
  let effAR = swap(rot) ? 1 / baseAR : baseAR;

  if (pageOrientation === "landscape" && effAR < 1) rot = norm(rot + 90);
  if (pageOrientation === "portrait"  && effAR > 1) rot = norm(rot + 90);

  const outW = swap(rot) ? baseH : baseW;
  const outH = swap(rot) ? baseW : baseH;

  const c = document.createElement("canvas");
  c.width = outW;
  c.height = outH;
  const ctx = c.getContext("2d")!;
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(img, -baseW / 2, -baseH / 2, baseW, baseH);

  // keep JPEG when possible to shrink PDF
  const url = src.startsWith("data:image/png")
    ? c.toDataURL("image/png")
    : c.toDataURL("image/jpeg", jpegQuality);

  return { url, w: outW, h: outH, ar: outW / outH };
}

// function drawHeader(
//   pdf: jsPDF,
//   {
//     title,
//     sizeText,
//     jobNumber,
//     pageW,
//     margin,
//   }: {
//     title: string;
//     sizeText: string;
//     jobNumber: string;
//     pageW: number;
//     margin: number;
//   }
// ): number {
//   let y = margin;
//   const availW = pageW - margin * 2;
//   const gutter = 6;        // spacing between title and yellow when sharing a line
//   const lhTitle = 8;       // ~ line height for 14pt
//   const lhSub   = 7;       // ~ line height for 12pt

//   // --- Job Number (bigger)
//   if (jobNumber) {
//     pdf.setFont("helvetica", "bold");
//     pdf.setFontSize(16);            // bigger than the others
//     pdf.setTextColor(40);           // dark gray/black
//     pdf.text(`Job Number: ${jobNumber}`, margin, y + 8);
//     y += 12;                        // generous gap after job number
//   }

//   // nothing else to draw?
//   if (!title && !sizeText) return y + 4;

//   // Measure whether title and size can share a single line
//   // 1) title single-line measurement
//   pdf.setFont("helvetica", "bold");
//   pdf.setFontSize(14);
//   pdf.setTextColor(33, 150, 243);

//   const titleOneLine = pdf.splitTextToSize(title || "", availW) as string[];
//   const titleIsSingleLine = title && titleOneLine.length === 1;
//   const titleOne = titleIsSingleLine ? titleOneLine[0] : "";

//   // 2) size width
//   pdf.setFontSize(12);
//   const sizeWidth = sizeText ? pdf.getTextWidth(sizeText) : 0;

//   // back to title font for drawing
//   pdf.setFontSize(14);
//   pdf.setTextColor(33, 150, 243);

//   // If we have BOTH texts and the title fits on one line AND
//   // the combined width (title + gutter + yellow) fits → share the first line.
//   const canShareLine =
//     !!(title && sizeText) &&
//     titleIsSingleLine &&
//     pdf.getTextWidth(titleOne) + (sizeWidth ? gutter + sizeWidth : 0) <= availW;

//   if (canShareLine) {
//     // draw title (left)
//     pdf.text(titleOne, margin, y + 6);

//     // draw yellow (right)
//     pdf.setFont("helvetica", "bold");
//     pdf.setFontSize(12);
//     pdf.setTextColor(255, 193, 7);
//     pdf.text(sizeText!, pageW - margin, y + 6, { align: "right" });

//     y += lhTitle + 6; // space after header row
//   } else {
//     // --- Title wrapped across full width
//     const titleLines = pdf.splitTextToSize(title || "", availW) as string[];
//     pdf.setFont("helvetica", "bold");
//     pdf.setFontSize(14);
//     pdf.setTextColor(33, 150, 243);
//     for (const line of titleLines) {
//       pdf.text(line, margin, y + 6);
//       y += lhTitle;
//     }

//     // --- Yellow wrapped on its own (right aligned, multi-line)
//     if (sizeText) {
//       pdf.setFont("helvetica", "bold");
//       pdf.setFontSize(12);
//       pdf.setTextColor(255, 193, 7);

//       const sizeLines = pdf.splitTextToSize(sizeText, availW) as string[];
//       for (const line of sizeLines) {
//         pdf.text(line, pageW - margin, y + 6, { align: "right" });
//         y += lhSub;
//       }
//     }

//     y += 6; // small gap after the header block
//   }

//   return y;
// }

  // Build PDF using images directly (keeps them sharp)
// const downloadPDF = async () => {
//   setIsGenerating(true);
//   try {
//     const M = 8; // page margin
//     const PAN_AR = PANORAMA_AR;

//     // helper to pick the page orientation for an entry
//     const pickOrientation = async (e: Entry) => {
//       if (e.orientation && e.orientation !== "auto") return e.orientation;
//       if (!e.image) return "portrait";
//       const raw = await new Promise<HTMLImageElement>((res, rej) => {
//         const im = new Image();
//         im.onload = () => res(im);
//         im.onerror = rej;
//         im.src = e.image!;
//       });
//       const ar = raw.naturalWidth / raw.naturalHeight;
//       return ar >= PAN_AR ? "landscape" : "portrait";
//     };

//     // decide the *first* page orientation BEFORE creating jsPDF
//     const orientations: ("portrait" | "landscape")[] = [];
//     for (let i = 0; i < entries.length; i++) {
//       orientations.push(await pickOrientation(entries[i]));
//     }
//     const firstOri = orientations[0] || "portrait";

//     // create the PDF with the correct first page orientation
//     const pdf = new jsPDF({ orientation: firstOri, compress: true });

//     for (let i = 0; i < entries.length; i++) {
//       const entry = entries[i];
//       if (!entry.image) continue;

//       // add a new page for i > 0 with the right orientation
//       if (i > 0) pdf.addPage(orientations[i]);

//       const pageW = pdf.internal.pageSize.getWidth();
//       const pageH = pdf.internal.pageSize.getHeight();

//       // header
//       pdf.setFont("helvetica", "bold");
//       pdf.setFontSize(14);
//       pdf.setTextColor(33, 150, 243);
//       if (entry.title) pdf.text(entry.title, M, M + 6);

//       pdf.setTextColor(255, 193, 7);
//       pdf.setFontSize(12);
//       if (entry.size) pdf.text(entry.size, pageW - M, M + 6, { align: "right" });

//       pdf.setTextColor(60, 60, 60);
//       pdf.setFontSize(12);
//       if (jobNumber) pdf.text(`Job Number: ${jobNumber}`, M, M + 14);

//       // content box
//       const top = M + 18;
//       const left = M;
//       const rawW = pageW - M * 2;
//       const rawH = pageH - top - M;

//       // pre-rotate pixels to match the page orientation + any user rotation
//       const userRot = ((entry as any).rotation ?? 0) as 0 | 90 | 180 | 270;
//       const rotated = await drawRotated(entry.image, userRot, orientations[i], JPEG_QUALITY);
//       const imgAR = rotated.ar;

//       const inset = imgAR >= PAN_AR ? PANORAMA_INSET : NORMAL_INSET;
//       const boxW = rawW * (1 - inset * 2);
//       const boxH = rawH * (1 - inset * 2);
//       const boxLeft = left + rawW * inset;
//       const boxTop  = top  + rawH * inset;

//       // contain fit
//       let drawW = boxW;
//       let drawH = drawW / imgAR;
//       if (drawH > boxH) {
//         drawH = boxH;
//         drawW = drawH * imgAR;
//       }

//       // scale + offsets (from your UI)
//       const scale = Math.min(100, Math.max(50, entry.scale ?? 100)) / 100;
//       drawW *= scale;
//       drawH *= scale;

//       const slackX = boxW - drawW;
//       const slackY = boxH - drawH;
//       const offX = ((entry.offsetX ?? 0) / 100) * (slackX / 2);
//       const offY = ((entry.offsetY ?? 0) / 100) * (slackY / 2);

//       const x = boxLeft + (boxW - drawW) / 2 + offX;
//       const y = boxTop  + (boxH - drawH) / 2 + offY;

//       // add the pre-rotated image (no jsPDF rotation)
//       const isJPEG = rotated.url.startsWith("data:image/jpeg");
//       pdf.addImage(rotated.url, isJPEG ? "JPEG" : "PNG", x, y, drawW, drawH);
//     }

//     pdf.save(`${jobNumber || "output"}.pdf`);
//   } catch (err) {
//     console.error("PDF generation failed", err);
//     alert("Something went wrong while generating the PDF.");
//   } finally {
//     setIsGenerating(false);
//   }
// };

// const downloadPDF = async () => {
//   setIsGenerating(true);
//   try {
//     const M = 8; // page margin
//     const PAN_AR = PANORAMA_AR;

//     // decide orientation for each entry (auto = panorama -> landscape)
//     const pickOrientation = async (e: Entry) => {
//       if (e.orientation && e.orientation !== "auto") return e.orientation;
//       if (!e.image) return "portrait";
//       const raw = await new Promise<HTMLImageElement>((res, rej) => {
//         const im = new Image();
//         im.onload = () => res(im);
//         im.onerror = rej;
//         im.src = e.image!;
//       });
//       const ar = raw.naturalWidth / raw.naturalHeight;
//       return ar >= PAN_AR ? "landscape" : "portrait";
//     };

//     // pre-compute orientations so the first page is correct
//     const orientations: ("portrait" | "landscape")[] = [];
//     for (let i = 0; i < entries.length; i++) {
//       orientations.push(await pickOrientation(entries[i]));
//     }
//     const firstOri = orientations[0] || "portrait";

//     // create PDF with the first page orientation
//     const pdf = new jsPDF({ orientation: firstOri, compress: true });

//     for (let i = 0; i < entries.length; i++) {
//       const entry = entries[i];
//       if (!entry.image) continue;

//       // add page with correct orientation for subsequent pages
//       if (i > 0) pdf.addPage(orientations[i]);

//       const pageW = pdf.internal.pageSize.getWidth();
//       const pageH = pdf.internal.pageSize.getHeight();

//       // ----- HEADER (wraps title, moves yellow to 2nd line if needed)
//       const topY = drawHeader(pdf, {
//         title: entry.title ?? "",
//         sizeText: entry.size ?? "",
//         jobNumber,
//         pageW,
//         margin: M,
//       });

//       // ----- CONTENT BOX (starts below header)
//       const left = M;
//       const rawW = pageW - M * 2;
//       const rawH = pageH - topY - M;

//       // pre-rotate pixels to match page orientation + any user rotation
//       const userRot = ((entry as any).rotation ?? 0) as 0 | 90 | 180 | 270;
//       const rotated = await drawRotated(entry.image, userRot, orientations[i], JPEG_QUALITY);
//       const imgAR = rotated.ar;

//       const inset = imgAR >= PAN_AR ? PANORAMA_INSET : NORMAL_INSET;
//       const boxW = rawW * (1 - inset * 2);
//       const boxH = rawH * (1 - inset * 2);
//       const boxLeft = left + rawW * inset;
//       const boxTop  = topY + rawH * inset;

//       // contain-fit inside the box
//       let drawW = boxW;
//       let drawH = drawW / imgAR;
//       if (drawH > boxH) {
//         drawH = boxH;
//         drawW = drawH * imgAR;
//       }

//       // user scale + offsets
//       const scale = Math.min(100, Math.max(50, entry.scale ?? 100)) / 100;
//       drawW *= scale;
//       drawH *= scale;

//       const slackX = boxW - drawW;
//       const slackY = boxH - drawH;
//       const offX = ((entry.offsetX ?? 0) / 100) * (slackX / 2);
//       const offY = ((entry.offsetY ?? 0) / 100) * (slackY / 2);

//       const x = boxLeft + (boxW - drawW) / 2 + offX;
//       const y = boxTop  + (boxH - drawH) / 2 + offY;

//       // draw the pre-rotated image (no jsPDF rotation)
//       const isJPEG = rotated.url.startsWith("data:image/jpeg");
//       pdf.addImage(rotated.url, isJPEG ? "JPEG" : "PNG", x, y, drawW, drawH);
//     }

//     pdf.save(`${jobNumber || "output"}.pdf`);
//   } catch (err) {
//     console.error("PDF generation failed", err);
//     alert("Something went wrong while generating the PDF.");
//   } finally {
//     setIsGenerating(false);
//   }
// };

const downloadPDF = async () => {
  setIsGenerating(true);
  try {
    const M = 8; // margin
    const PAN_AR = PANORAMA_AR;

    // helper: pick page orientation
    const pickOrientation = async (e: Entry) => {
      if (e.orientation && e.orientation !== "auto") return e.orientation;
      if (!e.image) return "portrait";
      const raw = await new Promise<HTMLImageElement>((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = e.image!;
      });
      const ar = raw.naturalWidth / raw.naturalHeight;
      return ar >= PAN_AR ? "landscape" : "portrait";
    };

    // pre-pick orientations
    const orientations: ("portrait" | "landscape")[] = [];
    for (let i = 0; i < entries.length; i++) {
      orientations.push(await pickOrientation(entries[i]));
    }
    const firstOri = orientations[0] || "portrait";

    // init pdf
    const pdf = new jsPDF({ orientation: firstOri, compress: true });

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.image) continue;

      if (i > 0) pdf.addPage(orientations[i]);

      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      let yPos = M + 6;

      // Job number (bigger, black, left aligned)
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.setTextColor(0, 0, 0);
      if (jobNumber) {
        pdf.text(`Job Number: ${jobNumber}`, M, yPos, {
          maxWidth: pageW - M * 2,
          align: "left",
        });
        yPos += 12;
      }

      // Title (blue, wraps, left aligned)
      pdf.setFontSize(14);
      pdf.setTextColor(33, 150, 243);
      if (entry.title) {
        pdf.text(entry.title, M, yPos, {
          maxWidth: pageW - M * 2,
          align: "left",
        });
        yPos += 10;
      }

      // Size (yellow, wraps, left aligned)
      pdf.setFontSize(12);
      pdf.setTextColor(255, 193, 7);
      if (entry.size) {
        pdf.text(entry.size, M, yPos, {
          maxWidth: pageW - M * 2,
          align: "left",
        });
        yPos += 10;
      }

      // content box
      const top = yPos + 6; // push content down after headers
      const left = M;
      const rawW = pageW - M * 2;
      const rawH = pageH - top - M;

      const userRot = ((entry as any).rotation ?? 0) as 0 | 90 | 180 | 270;
      const rotated = await drawRotated(
        entry.image,
        userRot,
        orientations[i],
        JPEG_QUALITY
      );
      const imgAR = rotated.ar;

      const inset = imgAR >= PAN_AR ? PANORAMA_INSET : NORMAL_INSET;
      const boxW = rawW * (1 - inset * 2);
      const boxH = rawH * (1 - inset * 2);
      const boxLeft = left + rawW * inset;
      const boxTop = top + rawH * inset;

      // contain fit
      let drawW = boxW;
      let drawH = drawW / imgAR;
      if (drawH > boxH) {
        drawH = boxH;
        drawW = drawH * imgAR;
      }

      const scale = Math.min(100, Math.max(50, entry.scale ?? 100)) / 100;
      drawW *= scale;
      drawH *= scale;

      const slackX = boxW - drawW;
      const slackY = boxH - drawH;
      const offX = ((entry.offsetX ?? 0) / 100) * (slackX / 2);
      const offY = ((entry.offsetY ?? 0) / 100) * (slackY / 2);

      const x = boxLeft + (boxW - drawW) / 2 + offX;
      const y = boxTop + (boxH - drawH) / 2 + offY;

      const isJPEG = rotated.url.startsWith("data:image/jpeg");
      pdf.addImage(rotated.url, isJPEG ? "JPEG" : "PNG", x, y, drawW, drawH);
    }

    pdf.save(`${jobNumber || "output"}.pdf`);
  } catch (err) {
    console.error("PDF generation failed", err);
    alert("Something went wrong while generating the PDF.");
  } finally {
    setIsGenerating(false);
  }
};

  return (
    <div className="min-h-screen p-6 bg-gray-100">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">📄 PDF Generator Preview</h1>

        <input
          type="text"
          placeholder="Job Number (shown on every page)"
          value={jobNumber}
          onChange={(e) => setJobNumber(e.target.value)}
          className="w-full p-3 text-lg border rounded font-semibold"
        />

        {entries.map((entry, index) => (
          <div
            key={index}
            className="relative p-4 mt-4 bg-white border rounded shadow space-y-3"
          >
            <div className="absolute top-1 right-1 z-20">
              <button
                onClick={() => deleteEntry(index)}
                className="text-red-500 hover:text-red-700 text-sm"
                title="Delete entry"
              >
                ❌
              </button>
            </div>

            <div className="space-y-2">
              <input
                type="text"
                placeholder="Enter Title (blue)"
                value={entry.title ?? ""}
                onChange={(e) => updateEntry(index, "title", e.target.value)}
                className="w-full p-2 border rounded"
              />

              <input
                type="text"
                placeholder="Enter Size (yellow)"
                value={entry.size ?? ""}
                onChange={(e) => updateEntry(index, "size", e.target.value)}
                className="w-full p-2 border rounded"
              />

              <label className="block text-sm text-gray-600">Orientation</label>
              <select
                value={entry.orientation || "auto"}
                onChange={(e) =>
                  updateEntry(
                    index,
                    "orientation",
                    e.target.value as "auto" | "portrait" | "landscape"
                  )
                }
                className="w-full p-2 border rounded"
              >
                <option value="auto">Auto (recommended)</option>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>

              {/* Rotation */}
              <label className="block text-sm text-gray-600 mt-2">
                Rotation
              </label>
              <select
                value={entry.rotation ?? 0}
                onChange={(e) =>
                  updateEntry(index, "rotation", parseInt(e.target.value, 10) as 0 | 90 | 180 | 270)
                }
                className="w-full p-2 border rounded"
              >
                <option value={0}>0°</option>
                <option value={90}>90°</option>
                <option value={180}>180°</option>
                <option value={270}>270°</option>
              </select>

              {/* Scale control */}
              <label className="block text-sm text-gray-600 mt-2">
                Scale: <span className="font-semibold">{entry.scale ?? 100}%</span>
              </label>
              <input
                type="range"
                min={50}
                max={100}
                step={1}
                value={entry.scale ?? 100}
                onChange={(e) =>
                  updateEntry(index, "scale", parseInt(e.target.value, 10))
                }
                className="w-full"
              />

              {/* Position controls */}
              <label className="block text-sm text-gray-600 mt-2">
                Horizontal position:{" "}
                <span className="font-semibold">{entry.offsetX ?? 0}%</span>
              </label>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={entry.offsetX ?? 0}
                onChange={(e) =>
                  updateEntry(index, "offsetX", parseInt(e.target.value, 10))
                }
                className="w-full"
              />

              <label className="block text-sm text-gray-600">
                Vertical position:{" "}
                <span className="font-semibold">{entry.offsetY ?? 0}%</span>
              </label>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={entry.offsetY ?? 0}
                onChange={(e) =>
                  updateEntry(index, "offsetY", parseInt(e.target.value, 10))
                }
                className="w-full"
              />

              <input
                type="file"
                accept=".png,.jpg,.jpeg,.tif,.tiff,image/*"
                onChange={(e) => handleImageUpload(e, index)}
                disabled={isUploading}
              />
            </div>

            <div
              ref={(el) => {
                previewRefs.current[index] = el;
              }}
              className="p-4 bg-white border mt-2"
            >
              <div className="text-lg text-gray-700 font-bold mb-2">
                Job Number: {jobNumber}
              </div>

              <div className="flex justify-between items-center px-4 py-2 border-b border-gray-200">
                <div className="text-blue-600 font-bold text-lg">
                  {entry.title}
                </div>
                <div className="text-yellow-500 font-bold text-lg">
                  {entry.size}
                </div>
              </div>

              {/* Large, responsive preview box */}
              {entry.image && (
                <div
                  className="mx-auto mt-3 overflow-hidden rounded border bg-white shadow-inner"
                  style={{
                    width: "min(95vw, 960px)",
                    height: "clamp(420px, 60vh, 640px)",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <img
                    src={entry.image}
                    alt="Cropped"
                    style={{
                      maxWidth: "100%",
                      maxHeight: "100%",
                      objectFit: "contain",
                      // translate from center, rotate (manual), then scale
                      transform: `translate(${(entry.offsetX ?? 0) / 2}%, ${
                        (entry.offsetY ?? 0) / 2
                      }%) rotate(${entry.rotation ?? 0}deg) scale(${Math.min(
                        1,
                        Math.max(0.5, (entry.scale ?? 100) / 100)
                      )})`,
                      transformOrigin: "center",
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        ))}

        <div className="flex gap-4">
          <button
            onClick={addEntry}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            ➕ Add More
          </button>

          {entries.length > 0 && entries.some((e) => e.image) && (
            <button
              onClick={downloadPDF}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              disabled={isGenerating}
            >
              📄 Download PDF
            </button>
          )}

          {isGenerating && (
            <div className="flex items-center gap-2 text-blue-600 font-medium">
              <svg
                className="animate-spin h-5 w-5 text-blue-600"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                />
              </svg>
              Generating PDF...
            </div>
          )}
        </div>
      </div>

      {/* Uploading overlay (TIFF convert spinner) */}
      {isUploading && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow p-6 flex items-center gap-3">
            <svg className="animate-spin h-6 w-6 text-blue-600" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
            <div className="text-blue-600 font-medium">
              {uploadingIndex !== null ? "Converting TIFF..." : "Uploading..."}
            </div>
          </div>
        </div>
      )}

      {cropIndex !== null && entries[cropIndex]?.originalImage && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white p-4 rounded shadow-lg max-w-3xl w-full">
            <h2 className="text-xl font-bold mb-4">Crop Image</h2>
            <Cropper
              src={entries[cropIndex].originalImage!}
              style={{ height: 400, width: "100%" }}
              viewMode={1}
              dragMode="move"
              zoomable
              scalable
              cropBoxResizable
              cropBoxMovable
              responsive
              background={false}
              autoCropArea={1}
              ref={cropperRef}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setCropIndex(null)}
                className="px-4 py-2 bg-gray-300 rounded"
              >
                Cancel
              </button>
              <button
                onClick={applyCrop}
                className="px-4 py-2 bg-blue-600 text-white rounded"
              >
                Apply Crop
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
