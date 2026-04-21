import React from "react";

const DataPreview = ({ headers, rows, title = "Data Preview", maxRows = 5 }) => {
  if (!Array.isArray(headers) || headers.length === 0) return null;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const previewRows = rows.slice(0, maxRows);

  return (
    <div className="glass-card card">
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="card__title" style={{ marginBottom: 0 }}>
          {title}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          Showing {Math.min(maxRows, rows.length)} of {rows.length} rows
        </div>
      </div>

      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, idx) => (
              <tr key={idx}>
                {headers.map((h) => (
                  <td key={`${idx}-${h}`}>{row?.[h] == null ? "-" : String(row[h])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DataPreview;
