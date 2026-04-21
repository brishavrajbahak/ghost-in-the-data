import React, { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileText, Ghost } from "lucide-react";

const FileUpload = ({ onSelectFile, isLoading }) => {
  const [sampleError, setSampleError] = useState(null);

  const onDrop = useCallback(
    (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        onSelectFile?.(acceptedFiles[0]);
      }
    },
    [onSelectFile]
  );

  const loadSample = async (path, filename) => {
    setSampleError(null);

    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }

      const blob = await response.blob();
      const file = new File([blob], filename, { type: "text/csv" });
      onSelectFile?.(file);
    } catch (err) {
      console.error(err);
      setSampleError("Couldn't load the sample dataset. Try refreshing the page.");
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/csv": [".csv"] },
    multiple: false,
  });

  return (
    <div>
      <div
        {...getRootProps()}
        className={`dropzone ${isDragActive ? "dropzone--active" : ""}`}
        aria-busy={isLoading ? "true" : "false"}
      >
        <input {...getInputProps()} />

        <div className="dropzone__iconWrap" aria-hidden="true">
          <div className="dropzone__iconGlow" />
          {isLoading ? (
            <Ghost size={44} color="rgba(0,240,255,0.95)" />
          ) : (
            <Upload size={44} color={isDragActive ? "rgba(0,240,255,0.95)" : "rgba(148,163,184,0.95)"} />
          )}
        </div>

        <div className="dropzone__title">{isLoading ? "Whispering to the data..." : "Feed the Ghost"}</div>
        <p className="dropzone__help">
          {isDragActive
            ? "Release to begin the haunting..."
            : "Drag and drop your CSV dataset here to uncover the spectral anomalies within."}
        </p>
      </div>

      <div className="upload__hint">
        <FileText size={16} />
        <span>Supports .csv files up to 50MB</span>
      </div>

      {!isLoading && (
        <div className="samples">
          <div className="samples__label">Or try a sample</div>
          <div className="samples__row">
            <button
              type="button"
              onClick={() => loadSample("/sample-datasets/ecommerce_sales.csv", "ecommerce_sales.csv")}
              className="btn btn--pill btn--subtle"
            >
              Ecommerce sales
            </button>
            <button
              type="button"
              onClick={() => loadSample("/sample-datasets/server_metrics.csv", "server_metrics.csv")}
              className="btn btn--pill btn--subtle"
            >
              Server metrics
            </button>
            <button
              type="button"
              onClick={() => loadSample("/sample-datasets/stock_prices.csv", "stock_prices.csv")}
              className="btn btn--pill btn--subtle"
            >
              Stock prices
            </button>
          </div>
          {sampleError && <p className="error">{sampleError}</p>}
        </div>
      )}
    </div>
  );
};

export default FileUpload;
