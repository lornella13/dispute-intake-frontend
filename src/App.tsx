
import { useState, useEffect, type FormEvent, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "";

if (import.meta.env.DEV && !API_BASE.trim()) {
  console.warn(
    "[Dispute Intake] VITE_API_BASE is missing. Set it in frontend/.env."
  );
}

interface Complaint {
  id: string;
  bank: string;
  operator_username: string;
  transfer_reference: string;
  amount: string;
  currency: string;
  category: string;
  description?: string;
  evidence?: string;
  registration_status: string;
  hub_claim_id?: string;
  hub_error_message?: string;
  created_at: string;
}

interface ApiError {
  error_code?: string;
  message?: string;
}

type ApiResponse = Record<string, unknown> | unknown[];

export default function App() {
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem("op_token")
  );

  const [currentBank, setCurrentBank] = useState<string | null>(
    () => localStorage.getItem("op_bank")
  );

  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");

  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [selected, setSelected] = useState<Complaint | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  const [txRef, setTxRef] = useState("");
  const [amount, setAmount] = useState("15000");
  const [category, setCategory] = useState("debited_not_credited");
  const [desc, setDesc] = useState("");
  const [evidence, setEvidence] = useState("");

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const showTxRefAlert =
    txRef.length > 0 && !/^TXN-\d{6}$/.test(txRef.trim());

  const showAmountAlert =
    amount.length > 0 && !/^\d+(\.\d{1,2})?$/.test(amount.trim());

  const showEvidenceAlert =
    (category === "wrong_recipient" || category === "scam") &&
    !evidence.trim();

  const handleLogout = useCallback(() => {
    localStorage.removeItem("op_token");
    localStorage.removeItem("op_bank");

    setToken(null);
    setCurrentBank(null);
    setComplaints([]);
    setSelected(null);
    setDetailLoading(null);
    setErrorMsg(null);
    setSuccessMsg(null);
  }, []);

  const readResponse = useCallback(
    async (res: Response): Promise<ApiResponse> => {
      const text = await res.text();

      if (!text) return {};

      try {
        const parsed: unknown = JSON.parse(text);

        if (Array.isArray(parsed)) return parsed;

        if (typeof parsed === "object" && parsed !== null) {
          return parsed as Record<string, unknown>;
        }

        return { message: String(parsed) };
      } catch {
        return { message: "The server returned an unexpected response." };
      }
    },
    []
  );

  const errorMessage = useCallback(
    (data: ApiResponse, fallback: string): string => {
      if (!Array.isArray(data)) {
        const obj = data as ApiError;

        if (typeof obj.message === "string" && obj.message.length > 0) {
          return obj.message;
        }

        if (
          typeof obj.error_code === "string" &&
          obj.error_code.length > 0
        ) {
          return `${obj.error_code}: ${fallback}`;
        }
      }

      return fallback;
    },
    []
  );

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: usernameInput.trim(),
          password: passwordInput,
        }),
      });

      const data = await readResponse(res);

      if (!res.ok) {
        setErrorMsg(
          errorMessage(
            data,
            "Login failed. Check your credentials and try again."
          )
        );
        return;
      }

      if (
        Array.isArray(data) ||
        !("access_token" in data) ||
        !("bank" in data) ||
        typeof data.access_token !== "string" ||
        typeof data.bank !== "string"
      ) {
        setErrorMsg("The login response is missing required information.");
        return;
      }

      localStorage.setItem("op_token", data.access_token);
      localStorage.setItem("op_bank", data.bank);

      setToken(data.access_token);
      setCurrentBank(data.bank);
      setUsernameInput("");
      setPasswordInput("");
    } catch {
      setErrorMsg("Cannot connect to the backend. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const loadComplaints = useCallback(
    async (currentToken: string) => {
      setErrorMsg(null);

      try {
        const res = await fetch(`${API_BASE}/complaints`, {
          headers: {
            Authorization: `Bearer ${currentToken}`,
          },
        });

        const data = await readResponse(res);

        if (res.status === 401 || res.status === 403) {
          handleLogout();
          setErrorMsg("Your session has expired. Please log in again.");
          return;
        }

        if (!res.ok) {
          setErrorMsg(
            errorMessage(data, "Could not load complaints from the backend.")
          );
          return;
        }

        let records: Complaint[] | null = null;

        if (Array.isArray(data)) {
          records = data as Complaint[];
        } else if (
          "complaints" in data &&
          Array.isArray(data.complaints)
        ) {
          records = data.complaints as Complaint[];
        }

        if (!records) {
          setErrorMsg(
            "The complaint response format differs from the expected format."
          );
          return;
        }

        setComplaints(records);

        setSelected((previous) => {
          if (!previous) return null;
          return records!.find((item) => item.id === previous.id) ?? null;
        });
      } catch {
        setErrorMsg("Connection failure while loading complaints.");
      }
    },
    [handleLogout, errorMessage, readResponse]
  );

  async function fetchComplaintDetail(
    currentToken: string,
    complaintId: string
  ) {
    setDetailLoading(complaintId);
    setErrorMsg(null);

    try {
      const res = await fetch(
        `${API_BASE}/complaints/${encodeURIComponent(complaintId)}`,
        {
          headers: {
            Authorization: `Bearer ${currentToken}`,
          },
        }
      );

      const data = await readResponse(res);

      if (res.status === 401 || res.status === 403) {
        handleLogout();
        setErrorMsg("Your session has expired. Please log in again.");
        return;
      }

      if (res.status === 404) {
        setErrorMsg("Complaint not found or you do not have access to it.");
        setSelected(null);
        return;
      }

      if (!res.ok) {
        setErrorMsg(errorMessage(data, "Could not load complaint details."));
        return;
      }

      if (!Array.isArray(data)) {
        setSelected(data as unknown as Complaint);
      }
    } catch {
      setErrorMsg("Connection failure while loading complaint details.");
    } finally {
      setDetailLoading(null);
    }
  }

  useEffect(() => {
    if (!token) return;
    const currentToken = token;
    let cancelled = false;

    const run = async () => {
      if (cancelled) return;
      await loadComplaints(currentToken);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [token, loadComplaints]);

  async function validateComplaint(
    currentToken: string,
    payload: {
      transfer_reference: string;
      amount: string;
      currency: string;
      category: string;
      description?: string;
      evidence?: string | null;
    }
  ): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/complaints/validate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await readResponse(res);

      if (!res.ok) {
        setErrorMsg(errorMessage(data, "Complaint data is invalid."));
        return false;
      }

      if (!Array.isArray(data) && "valid" in data) {
        return data.valid === true;
      }

      return false;
    } catch {
      setErrorMsg("Could not validate complaint. Check your connection.");
      return false;
    }
  }

  async function handleSubmitComplaint(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    setErrorMsg(null);
    setSuccessMsg(null);

    if (!token) {
      setErrorMsg("Please log in before submitting a complaint.");
      return;
    }

    if (!/^TXN-\d{6}$/.test(txRef.trim())) {
      setErrorMsg("Use a transaction reference like TXN-100293.");
      return;
    }

    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) {
      setErrorMsg("Enter a valid amount greater than zero.");
      return;
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setErrorMsg("Enter a valid amount greater than zero.");
      return;
    }

    if (showEvidenceAlert) {
      setErrorMsg(
        `Category '${category}' requires evidence. Please select a file.`
      );
      return;
    }

    const payload = {
      transfer_reference: txRef.trim(),
      amount: amount.trim(),
      currency: "RWF",
      category,
      description: desc.trim(),
      evidence: evidence || null,
    };

    setLoading(true);

    try {
      const isValid = await validateComplaint(token, payload);

      if (!isValid) return;

      const res = await fetch(`${API_BASE}/complaints`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await readResponse(res);

      if (res.status === 401 || res.status === 403) {
        handleLogout();
        setErrorMsg("Your session has expired or access was denied.");
        return;
      }

      if (!res.ok) {
        setErrorMsg(
          errorMessage(data, "The complaint could not be submitted.")
        );
        return;
      }

      setTxRef("");
      setAmount("15000");
      setCategory("debited_not_credited");
      setDesc("");
      setEvidence("");

      setSuccessMsg("Complaint submitted successfully.");
      await loadComplaints(token);
    } catch {
      setErrorMsg("Could not submit the complaint. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-4 font-sans">
        <section className="bg-white p-8 rounded-lg shadow-md max-w-md w-full border border-slate-200">
          <h1 className="text-2xl font-semibold text-slate-900 text-center mb-2">
            Dispute Intake Workstation
          </h1>

          <p className="text-sm text-slate-600 text-center mb-6">
            Operator Login
          </p>

          {errorMsg && (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 text-red-800 p-3 mb-4 rounded-md text-sm"
            >
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Operator Username
              </label>
              <input
                required
                autoComplete="username"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                className="w-full border border-slate-300 rounded-md p-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Password
              </label>
              <input
                required
                type="password"
                autoComplete="current-password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                className="w-full border border-slate-300 rounded-md p-2"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium py-2.5 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans">
      <header className="px-4 sm:px-6 py-3 shadow-sm flex flex-wrap justify-between items-center gap-3 bg-blue-700 text-white border-b border-blue-800">
        <div>
          <h1 className="text-xl font-semibold text-white">
            Dispute Intake Workstation
          </h1>

          <p className="text-sm text-blue-100">
            Bank:{" "}
            <span
              className={`font-medium px-2 py-0.5 rounded-full text-xs ${
                currentBank === "Greenbank"
                  ? "text-emerald-700 bg-emerald-50"
                  : currentBank === "Bluemobile"
                    ? "text-blue-700 bg-blue-50"
                    : "text-slate-700 bg-slate-100"
              }`}
            >
              {currentBank?.toUpperCase() || "—"}
            </span>
          </p>
        </div>

        <button
          onClick={handleLogout}
          className="bg-blue-600 hover:bg-blue-500 active:bg-blue-800 text-white text-sm font-medium px-3 py-1.5 rounded-md border border-blue-500 transition"
        >
          Logout
        </button>
      </header>

      {errorMsg && (
        <div
          role="alert"
          className="mx-4 sm:mx-6 mt-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md text-sm"
        >
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div
          role="status"
          className="mx-4 sm:mx-6 mt-4 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-md text-sm"
        >
          {successMsg}
        </div>
      )}

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 items-start">

          {}
          <section className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <header className="px-4 py-3 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">
                Record New Complaint
              </h2>
            </header>

            <div className="p-4">
              <form onSubmit={handleSubmitComplaint} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold mb-2 text-slate-700">
                    Transfer Reference
                  </label>
                  <input
                    required
                    value={txRef}
                    onChange={(e) => setTxRef(e.target.value)}
                    placeholder="TXN-100293"
                    className="w-full border border-slate-300 rounded-md p-2"
                  />

                  {showTxRefAlert && (
                    <p className="text-red-700 text-xs mt-1">
                      Expected format: TXN-100293
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold mb-2 text-slate-700">
                    Amount (RWF)
                  </label>
                  <input
                    required
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full border border-slate-300 rounded-md p-2"
                  />

                  {showAmountAlert && (
                    <p className="text-red-700 text-xs mt-1">
                      Enter a positive decimal amount, e.g. 15000 or 15000.50.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold mb-2 text-slate-700">
                    Complaint Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full border border-slate-300 rounded-md p-2 bg-white"
                  >
                    <option value="debited_not_credited">
                      Debited Not Credited
                    </option>
                    <option value="wrong_recipient">Wrong Recipient</option>
                    <option value="duplicate">Duplicate Entry</option>
                    <option value="scam">Scam / Fraud</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold mb-2 text-slate-700">
                    Evidence File
                  </label>
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={(e) => {
                      const file = e.target.files?.[0];

                      if (!file) {
                        setEvidence("");
                        return;
                      }

                      const allowedTypes = [
                        "application/pdf",
                        "image/png",
                        "image/jpeg",
                      ];

                      if (!allowedTypes.includes(file.type)) {
                        setErrorMsg("Choose a PDF, PNG, or JPEG file.");
                        e.target.value = "";
                        setEvidence("");
                        return;
                      }

                      if (file.size > 5 * 1024 * 1024) {
                        setErrorMsg("The file must be 5 MB or smaller.");
                        e.target.value = "";
                        setEvidence("");
                        return;
                      }

                      setErrorMsg(null);
                      setEvidence(file.name);
                    }}
                    className="w-full text-sm"
                  />

                  {evidence && (
                    <p className="text-xs mt-2 text-slate-600 break-words">
                      Selected: {evidence}
                      {" "}(filename only; file not uploaded)
                    </p>
                  )}

                  {showEvidenceAlert && (
                    <p className="text-red-700 text-xs mt-1">
                      Evidence is required for this category.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold mb-2 text-slate-700">
                    Private Operator Notes
                  </label>
                  <textarea
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    className="w-full border border-slate-300 rounded-md p-2"
                  />
                </div>

                <button
                  type="submit"
                  disabled={
                    loading ||
                    showTxRefAlert ||
                    showAmountAlert ||
                    showEvidenceAlert
                  }
                  className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {loading ? "Processing..." : "Submit Complaint"}
                </button>
              </form>
            </div>
          </section>

          {}
          <section className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <header className="px-4 py-3 border-b border-slate-200 flex justify-between items-center gap-3">
              <h2 className="text-base font-semibold text-slate-900">
                Complaint Queue
              </h2>

              <button
                type="button"
                onClick={() => {
                  if (token) void loadComplaints(token);
                }}
                className="text-sm text-blue-700 hover:text-blue-900 font-medium"
              >
                Refresh
              </button>
            </header>

            <div className="p-4">
              {complaints.length === 0 ? (
                <p className="text-sm text-slate-600">
                  No complaints found.
                </p>
              ) : (
                <div className="space-y-3 overflow-y-auto max-h-[600px]">
                  {complaints.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => {
                        setSelected(null);
                        void fetchComplaintDetail(token, item.id);
                      }}
                      className={`w-full text-left p-3 rounded-lg border transition ${
                        selected?.id === item.id
                          ? "border-blue-500 bg-blue-50"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <span className="font-mono text-xs break-all">
                          {item.id}
                        </span>

                        <span className="text-xs font-semibold text-slate-700 text-right">
                          {item.registration_status}
                        </span>
                      </div>

                      <div className="flex justify-between items-start gap-2 mt-3 text-xs text-slate-600">
                        <span>{item.transfer_reference}</span>
                        <span className="font-medium text-slate-900">
                          {item.amount} {item.currency}
                        </span>
                      </div>

                      <p className="text-xs text-slate-500 mt-2">
                        {item.category.replaceAll("_", " ")}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {}
          <section className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <header className="px-4 py-3 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">
                Complaint Details
              </h2>
            </header>

            <div className="p-4">
              {detailLoading && (
                <p className="text-sm text-slate-600">
                  Loading complaint details...
                </p>
              )}

              {!detailLoading && !selected && (
                <p className="text-sm text-slate-600">
                  Select a complaint from the queue to view its details.
                </p>
              )}

              {!detailLoading && selected && (
                <div className="space-y-4 text-sm">
                  <div>
                    <p className="font-bold text-xs uppercase text-slate-500">
                      Complaint ID
                    </p>
                    <p className="break-all">{selected.id}</p>
                  </div>

                  <div>
                    <p className="font-bold text-xs uppercase text-slate-500">
                      Bank
                    </p>
                    <p>{selected.bank}</p>
                  </div>

                  <div>
                    <p className="font-bold text-xs uppercase text-slate-500">
                      Status
                    </p>
                    <p>{selected.registration_status}</p>
                  </div>

                  <div>
                    <p className="font-bold text-xs uppercase text-slate-500">
                      Transaction Reference
                    </p>
                    <p>{selected.transfer_reference}</p>
                  </div>

                  <div>
                    <p className="font-bold text-xs uppercase text-slate-500">
                      Amount
                    </p>
                    <p>
                      {selected.amount} {selected.currency}
                    </p>
                  </div>

                  <div>
                    <p className="font-bold text-xs uppercase text-slate-500">
                      Category
                    </p>
                    <p>{selected.category.replaceAll("_", " ")}</p>
                  </div>

                  <div>
                    <p className="font-bold text-xs uppercase text-slate-500">
                      Created At
                    </p>
                    <p>{selected.created_at}</p>
                  </div>

                  {selected.hub_claim_id && (
                    <div>
                      <p className="font-bold text-xs uppercase text-slate-500">
                        Hub Claim ID
                      </p>
                      <p className="break-all">{selected.hub_claim_id}</p>
                    </div>
                  )}

                  {selected.hub_error_message && (
                    <div>
                      <p className="font-bold text-xs uppercase text-slate-500">
                        Hub Response
                      </p>
                      <p className="text-red-700 break-words">
                        {selected.hub_error_message}
                      </p>
                    </div>
                  )}

                  {selected.description && (
                    <div>
                      <p className="font-bold text-xs uppercase text-slate-500">
                        Operator Notes
                      </p>
                      <p className="whitespace-pre-wrap break-words">
                        {selected.description}
                      </p>
                    </div>
                  )}

                  {selected.evidence && (
                    <div>
                      <p className="font-bold text-xs uppercase text-slate-500">
                        Evidence Reference
                      </p>
                      <p className="break-words">{selected.evidence}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
