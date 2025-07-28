import { useState, useRef } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { Cropper } from "react-cropper";
import type { ReactCropperElement } from "react-cropper";
import "cropperjs/dist/cropper.css";

type Entry = {
  title: string | null;
  size: string | null;
  image: string | null;
  originalImage?: string | null; // For cropping
};

function App() {
  const [jobNumber, setJobNumber] = useState<string>("");
  const [entries, setEntries] = useState<Entry[]>([{ title: "", size: "", image: null }]);
  const [cropIndex, setCropIndex] = useState<number | null>(null);
  const cropperRef = useRef<ReactCropperElement>(null);
  const previewRefs = useRef<(HTMLDivElement | null)[]>([]);

  const updateEntry = (index: number, field: keyof Entry, value: string | null) => {
    const updated = [...entries];
    updated[index][field] = value;
    setEntries(updated);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();

    if (
      file.type === "image/tiff" ||
      fileName.endsWith(".tif") ||
      fileName.endsWith(".tiff")
    ) {
      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("http://localhost:4000/upload", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (data.base64) {
          updateEntry(index, "originalImage", `data:image/png;base64,${data.base64}`);
          setCropIndex(index);
        } else {
          alert("TIFF conversion failed.");
        }
      } catch (err) {
        console.error(err);
        alert("Error uploading TIFF image.");
      }
    } else {
      const url = URL.createObjectURL(file);
      updateEntry(index, "originalImage", url);
      setCropIndex(index);
    }
  };

  const applyCrop = () => {
    if (cropIndex === null || !cropperRef.current) return;
    const croppedCanvas = cropperRef.current?.cropper?.getCroppedCanvas();
    if (!croppedCanvas) return;
    const croppedData = croppedCanvas.toDataURL();
    updateEntry(cropIndex, "image", croppedData);
    updateEntry(cropIndex, "originalImage", null); // Clear original after crop
    setCropIndex(null);
  };

  const addEntry = () => {
    setEntries([...entries, { title: "", size: "", image: null }]);
  };

  const deleteEntry = (index: number) => {
    setEntries(entries.filter((_, i) => i !== index));
  };

  const downloadPDF = async () => {
    const pdf = new jsPDF("portrait", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    for (let i = 0; i < entries.length; i++) {
      const ref = previewRefs.current[i];
      if (!ref) continue;

      const canvas = await html2canvas(ref, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        scrollY: -window.scrollY,
      });

      const imgData = canvas.toDataURL("image/png");
      const imgProps = pdf.getImageProperties(imgData);
      const imgWidth = pageWidth;
      const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
      const yOffset = (pageHeight - imgHeight) / 2;

      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, yOffset, imgWidth, imgHeight);
    }

    pdf.save(`${jobNumber || "output"}.pdf`);
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

              <input
                type="file"
                accept=".png,.jpg,.jpeg,.tif,.tiff,image/*"
                onChange={(e) => handleImageUpload(e, index)}
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
                <div className="text-blue-600 font-bold text-lg">{entry.title}</div>
                <div className="text-yellow-500 font-bold text-lg">{entry.size}</div>
              </div>

              {entry.image && (
                <div className="w-full max-w-[600px] max-h-[400px] overflow-hidden mx-auto">
                  <img src={entry.image} alt="Cropped" className="object-contain w-full h-auto" />
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
            >
               📄 Download PDF
            </button>
          )}
        </div>
      </div>

      {cropIndex !== null && entries[cropIndex]?.originalImage && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white p-4 rounded shadow-lg max-w-3xl w-full">
            <h2 className="text-xl font-bold mb-4">Crop Image</h2>
            <Cropper
              src={entries[cropIndex].originalImage!}
             style={{ height: 400, width: "100%" }}
  // Enable zoom, drag, resize behavior
  viewMode={1}
  dragMode="move"
  zoomable={true}
  scalable={true}
  cropBoxResizable={true}
  cropBoxMovable={true}
  responsive={true}
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
