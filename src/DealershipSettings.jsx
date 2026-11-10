import React, { useState } from "react";
import { dealershipCandidates } from "../shared/domain";
export default function DealershipSettings({ config, vehicles, onSave }) {
  const [form, setForm] = useState(config),
    [mapping, setMapping] = useState(
      JSON.stringify(config.variable_mapping, null, 2),
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const set = (key, value) =>
    setForm((s) => ({
      ...s,
      [key]: value,
      ...(["dealeros_id", "postx_group_id"].includes(key)
        ? { mapping_verified: false }
        : {}),
      ...(["template_name", "card_count"].includes(key)
        ? { template_verified: false }
        : {}),
    }));
  const candidates = dealershipCandidates(config.name, vehicles);
  const sources = [
    ...new Map(
      vehicles.map((v) => [v.dealership_id, v.dealership_name]),
    ).entries(),
  ];
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave({
        ...form,
        postx_group_id: Number(form.postx_group_id),
        card_count: Number(form.card_count),
        variable_mapping: JSON.parse(mapping),
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="panel settings-panel" onSubmit={save}>
      <h2>{config.name}</h2>
      <p>
        PostX group IDs and DealerOS dealership IDs are separate. Candidate
        matches are never automatically approved.
      </p>
      <div className="alert">
        {candidates.length === 1
          ? `Candidate: ${candidates[0].name} (${candidates[0].id}). Verify before enabling.`
          : candidates.length > 1
            ? "Ambiguous name match. Resolve manually."
            : "No exact name candidate. Choose and verify the correct source dealership."}
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="form-grid">
        <label>
          DealerOS dealership
          <select
            value={form.dealeros_id || ""}
            onChange={(e) => set("dealeros_id", e.target.value)}
          >
            <option value="">Unmapped</option>
            {sources.map(([id, name]) => (
              <option key={id} value={id}>
                {name} ({id})
              </option>
            ))}
          </select>
        </label>
        <label>
          PostX group ID
          <input
            required
            type="number"
            min="1"
            step="1"
            value={form.postx_group_id}
            onChange={(e) => set("postx_group_id", e.target.value)}
          />
        </label>
        <label>
          Approved template name
          <input
            value={form.template_name}
            onChange={(e) => set("template_name", e.target.value)}
          />
        </label>
        <label>
          Required card count
          <input
            type="number"
            min="2"
            max="10"
            value={form.card_count}
            onChange={(e) => set("card_count", e.target.value)}
          />
        </label>
      </div>
      <label>
        Case-sensitive template variable mappings (JSON)
        <textarea
          rows="10"
          value={mapping}
          onChange={(e) => {
            setMapping(e.target.value);
            set("template_verified", false);
          }}
        />
      </label>
      <p>
        Keys are exact approved PostX variable names. Values select a source:
        card fields car_type, year, mileage, retail_price, make, model,
        derivative, stock_number; recipient fields name, dealership_name. Fixed
        values use literal:your value. Use empty objects if no variables are
        required.
      </p>
      {[
        [
          "mapping_verified",
          "I verified this DealerOS dealership and PostX group mapping.",
        ],
        [
          "template_verified",
          "I verified this template, exact variables and card count are approved in PostX.",
        ],
        ["active", "Dealership is active."],
      ].map(([key, label]) => (
        <label className="check-label" key={key}>
          <input
            type="checkbox"
            checked={form[key]}
            onChange={(e) => set(key, e.target.checked)}
          />
          {label}
        </label>
      ))}
      <button disabled={busy} className="button">
        {busy ? "Saving…" : "Save dealership settings"}
      </button>
    </form>
  );
}
