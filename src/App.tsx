import { useState, useRef } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

function App() {
  const [title, setTitle] = useState<string>("");
  const [size, setSize] = useState<string>("");
  const [image, setImage] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
          setImage(`data:image/png;base64,${data.base64}`);
        } else {
          alert("TIFF conversion failed.");
        }
      } catch (err) {
        console.error(err);
        alert("Error uploading TIFF image.");
      }
      return;
    }

    // Default PNG/JPG
    const url = URL.createObjectURL(file);
    setImage(url);
  };
const downloadPDF = async () => {
  if (!previewRef.current) return;

  const canvas = await html2canvas(previewRef.current, {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true,
    scrollY: -window.scrollY,
  });

  const imgData = canvas.toDataURL("image/png");
  const pdfWidth = canvas.width * 0.75;
  const pdfHeight = canvas.height * 0.75;

  const pdf = new jsPDF("landscape", "px", [pdfWidth, pdfHeight]);
  pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
  pdf.save(`${title || "preview"}.pdf`);
};

  return (
    <div className="min-h-screen p-6 bg-gray-100">
      <div className="max-w-6xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold">🚌 Ad Preview PDF Generator</h1>

        <input
          type="text"
          placeholder="Enter Title (blue)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full p-2 border rounded"
        />

        <input
          type="text"
          placeholder="Enter Size (yellow)"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          className="w-full p-2 border rounded"
        />

        <input
          type="file"
          accept=".png,.jpg,.jpeg,.tif,.tiff,image/*"
          onChange={handleImageUpload}
        />

          {image && (
          <div
            ref={previewRef}
            className="mt-6 border border-gray-300 rounded overflow-hidden shadow bg-white"
          >
            {/* Text bar above image */}
            <div className="flex justify-between items-center px-4 py-2 border-b border-gray-200">
              <div className="text-blue-600 font-bold text-lg">{title}</div>
              <div className="text-yellow-500 font-bold text-lg">{size}</div>
            </div>

             {/* Bus Image - scaled down */}
            <img
              src={image}
              alt="Bus"
              style={{
                width: "100%",
                display: "block",
                transform: "scale(0.95)",
                transformOrigin: "top center",
              }}
            />
          </div>
          
        )}

        {image && (
          <button
            onClick={downloadPDF}
            className="w-full p-3 mt-4 text-white bg-green-600 rounded hover:bg-green-700"
          >
            Download PDF
          </button>
        )}
      </div>
    </div>
  );
}

export default App;
