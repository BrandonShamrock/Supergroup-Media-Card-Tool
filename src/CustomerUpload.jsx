import React, { useState } from "react";
import Papa from "papaparse";
import { importRecipients } from "../shared/domain";

export default function CustomerUpload({ onChange, result }) {
  const [rows, setRows] = useState([]),
    [nameColumn, setName] = useState(""),
    [phoneColumn, setPhone] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const clear = () => {
    setRows([]);
    setName("");
    setPhone("");
    setError("");
    onChange(null);
  };
  const choose = async (file) => {
    clear();
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 5 * 1024 * 1024 || !/\.(xlsx|csv)$/i.test(file.name))
        throw new Error("Choose a .xlsx or .csv file up to 5 MiB.");
      let data;
      if (/\.csv$/i.test(file.name)) {
        const parsed = Papa.parse(await file.text(), {
          skipEmptyLines: "greedy",
        });
        if (parsed.errors.length)
          throw new Error(
            "CSV could not be parsed. Check delimiters and quotes.",
          );
        data = parsed.data;
      } else {
        const { readSheet: readXlsxFile } =
          await import("read-excel-file/browser");
        data = await readXlsxFile(file);
      }
      data = data.filter((row) =>
        row.some((cell) => cell != null && String(cell).trim()),
      );
      if (data.length < 2 || data.length > 10001 || data[0].length > 100)
        throw new Error(
          "Include a header row and 1–10,000 data rows, with at most 100 columns.",
        );
      setRows(data);
      const headers = data[0].map((v) =>
        String(v || "")
          .toLowerCase()
          .trim(),
      );
      const n = headers.findIndex((v) =>
        ["name", "customer name", "client name"].includes(v),
      );
      const p = headers.findIndex((v) =>
        [
          "whatsapp number",
          "whatsapp_number",
          "mobile",
          "phone",
          "cellphone",
        ].includes(v),
      );
      setName(n >= 0 ? String(n) : "");
      setPhone(p >= 0 ? String(p) : "");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const process = () => {
    try {
      if (nameColumn === "" || phoneColumn === "")
        throw new Error("Map both spreadsheet columns.");
      onChange(
        importRecipients(
          rows.slice(1),
          Number(nameColumn),
          Number(phoneColumn),
        ),
      );
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <section className="panel upload-panel">
      <div className="alert">
        <div>
          <strong>Handle customer information responsibly</strong>
          <p>
            Only import recipients you are authorized to contact with the
            required WhatsApp marketing consent. Files stay in browser memory;
            validated names/numbers are sent to the private queue only after
            final submission. Clear the upload when finished. International
            numbers must include + and country code; local numbers use South
            Africa.
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          choose(e.dataTransfer.files[0]);
        }}
      >
        <h2>Import your customer audience</h2>
        <p>Excel .xlsx or CSV · Up to 5 MiB · First row contains headers</p>
        <label className="button file-button">
          {busy ? "Reading file…" : "Choose customer file"}
          <input
            disabled={busy}
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => {
              choose(e.target.files[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {rows.length > 0 && (
        <>
          <div className="form-grid">
            {[
              ["Customer name", nameColumn, setName],
              ["WhatsApp number", phoneColumn, setPhone],
            ].map(([label, value, set]) => (
              <label key={label}>
                {label}
                <select
                  value={value}
                  onChange={(e) => {
                    set(e.target.value);
                    onChange(null);
                  }}
                >
                  <option value="">Choose column</option>
                  {rows[0].map((h, i) => (
                    <option value={i} key={i}>
                      {String(h || `Column ${i + 1}`)} (column {i + 1})
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button className="button" onClick={process}>
            Validate recipients
          </button>
        </>
      )}
      {result && (
        <>
          <h3 className="import-summary">
            {result.recipients.length} valid · {result.duplicates} duplicates
            removed · {result.invalid.length} invalid
          </h3>
          <p>Preview (first 10, numbers masked)</p>
          <ul>
            {result.recipients.slice(0, 10).map((r, i) => (
              <li key={i}>
                {r.name} · {r.whatsapp_number.slice(0, 4)}••••
                {r.whatsapp_number.slice(-3)}
              </li>
            ))}
          </ul>
          {result.invalid.length > 0 && (
            <details>
              <summary>Invalid rows (first 50)</summary>
              <ul>
                {result.invalid.slice(0, 50).map((r) => (
                  <li key={r.row}>
                    Row {r.row}: {r.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <button className="button secondary" onClick={clear}>
        Clear upload and recipients
      </button>
    </section>
  );
}
