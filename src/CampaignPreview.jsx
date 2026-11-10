import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { buildPayload } from "../shared/domain";
export default function CampaignPreview({
  config,
  vehicles,
  recipients,
  sending,
  onQueued,
}) {
  const [name, setName] = useState(""),
    [preview, setPreview] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [confirm, setConfirm] = useState("");
  const requestId = useRef(crypto.randomUUID());
  let validation = "";
  try {
    buildPayload(config, vehicles, recipients.slice(0, 1), "preview");
    if (!recipients.length)
      throw new Error("Import a valid customer audience.");
  } catch (e) {
    validation = e.message;
  }
  const body = {
    dealership_id: config?.id,
    vehicle_ids: vehicles.map((v) => v.source_id),
    recipients,
  };
  const bodyKey = JSON.stringify(body);
  useEffect(() => {
    let active = true;
    setPreview(null);
    setConsent(false);
    setConfirm("");
    if (!validation)
      api("preview", JSON.parse(bodyKey))
        .then((r) => {
          if (active) setPreview(r);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [bodyKey, validation]);
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("queue", {
        ...body,
        campaign_name: name,
        confirmation: confirm,
        request_id: requestId.current,
      });
      onQueued(result.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="preview-layout">
      <section className="panel preview-sheet">
        <div className="preview-brand">
          <h2>WhatsApp carousel preview</h2>
          <span>{vehicles.length} CARDS</span>
        </div>
        <p>
          Cards are sent in the order below. Return to stock to change the
          selection order.
        </p>
        <div className="whatsapp-preview">
          <p>
            Hello {"{{customer name}}"}, explore our latest selection at{" "}
            {config?.name || "your dealership"}.
          </p>
          <div className="carousel-strip">
            {vehicles.map((v, i) => (
              <article key={v.source_id}>
                <span className="sample-label">CARD {i + 1}</span>
                <img
                  src={v.primary_image_url}
                  referrerPolicy="no-referrer"
                  alt={`${v.make} ${v.model}`}
                />
                <h3>
                  {v.make} {v.model}
                </h3>
                <p>{v.derivative}</p>
                <p>
                  {v.year} · {Number(v.mileage).toLocaleString()} km
                </p>
                <strong>
                  {Number(v.retail_price).toLocaleString("en-ZA", {
                    style: "currency",
                    currency: "ZAR",
                    maximumFractionDigits: 0,
                  })}
                </strong>
              </article>
            ))}
          </div>
          <small>
            Layout is illustrative. Approved PostX template controls final
            message copy and presentation.
          </small>
        </div>
        {!vehicles.length && (
          <p className="empty-state">
            Select vehicles from stock to create a carousel.
          </p>
        )}
      </section>
      <form className="panel campaign-details" onSubmit={send}>
        <h2>Campaign details</h2>
        <dl>
          <dt>Dealership</dt>
          <dd>{config?.name || "Not selected"}</dd>
          <dt>PostX group</dt>
          <dd>{config?.postx_group_id || "Unmapped"}</dd>
          <dt>Approved template</dt>
          <dd>{config?.template_name || "Not configured"}</dd>
          <dt>Required cards</dt>
          <dd>{config?.card_count || "—"}</dd>
          <dt>Valid recipients</dt>
          <dd>{recipients.length}</dd>
          <dt>Expected batches</dt>
          <dd>{preview?.batch_count ?? "Limit unverified"}</dd>
        </dl>
        {validation && (
          <div className="alert" role="alert">
            {validation}
          </div>
        )}
        {preview?.warnings.map((w) => (
          <div className="alert" key={w}>
            {w}
          </div>
        ))}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <label>
          Campaign name
          <input
            maxLength="120"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="alert">
          <strong>
            Sending will contact real customers. Accepted means processing, not
            delivered. An uncertain batch will require manual reconciliation.
          </strong>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          I reviewed the cards, mapping, template and audience, and confirm
          permission to contact these customers.
        </label>
        <label>
          Type SEND TO REAL CUSTOMERS
          <input
            autoComplete="off"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <button
          className="button"
          disabled={
            busy ||
            !!validation ||
            !preview?.batch_count ||
            !sending.enabled ||
            !consent ||
            confirm !== "SEND TO REAL CUSTOMERS" ||
            !name.trim()
          }
        >
          {busy ? "Validating and queuing…" : "Confirm and queue campaign"}
        </button>
      </form>
    </div>
  );
}
