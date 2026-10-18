import { cookies } from "next/headers";
import crypto from "node:crypto";
import { redirect } from "next/navigation";

const ADMIN_GATE_COOKIE = "admin_gate";

async function gatePassed(): Promise<boolean> {
  const secret = process.env.ADMIN_GATE_SECRET;
  if (!secret) return true;
  const cookieStore = await cookies();
  const value = cookieStore.get(ADMIN_GATE_COOKIE)?.value;
  if (!value) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(ADMIN_GATE_COOKIE)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected));
  } catch {
    return false;
  }
}

export const dynamic = "force-dynamic";

export default async function AdminGatePage() {
  if (await gatePassed()) {
    redirect("/admin/ops");
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        .admin-gate-wrap {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f3f4f6;
          padding: 1rem;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .admin-gate-card {
          width: 100%;
          max-width: 24rem;
          background: #ffffff;
          border-radius: 0.75rem;
          border: 1px solid #e5e7eb;
          box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);
          padding: 2rem;
        }
        .admin-gate-icon {
          width: 3rem;
          height: 3rem;
          margin: 0 auto 1rem;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 9999px;
          background: #eff6ff;
        }
        .admin-gate-icon svg {
          width: 1.5rem;
          height: 1.5rem;
          color: #2563eb;
        }
        .admin-gate-title {
          text-align: center;
          font-size: 1.25rem;
          font-weight: 600;
          color: #111827;
          margin: 0 0 0.25rem;
        }
        .admin-gate-subtitle {
          text-align: center;
          font-size: 0.875rem;
          color: #6b7280;
          margin: 0 0 1.5rem;
        }
        .admin-gate-label {
          display: block;
          font-size: 0.875rem;
          font-weight: 500;
          color: #374151;
          margin-bottom: 0.5rem;
        }
        .admin-gate-input {
          width: 100%;
          height: 2.75rem;
          padding: 0 0.75rem;
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          color: #111827;
          background: #ffffff;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
          box-sizing: border-box;
        }
        .admin-gate-input:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59,130,246,0.15);
        }
        .admin-gate-input::placeholder { color: #9ca3af; }
        .admin-gate-btn {
          width: 100%;
          height: 2.75rem;
          margin-top: 1rem;
          background: #2563eb;
          color: #ffffff;
          border: none;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s;
          box-sizing: border-box;
        }
        .admin-gate-btn:hover { background: #1d4ed8; }
        .admin-gate-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .admin-gate-error {
          display: none;
          align-items: center;
          gap: 0.5rem;
          margin-top: 0.75rem;
          font-size: 0.875rem;
          color: #dc2626;
        }
        .admin-gate-error.show { display: flex; }
        .admin-gate-error svg { width: 1rem; height: 1rem; flex-shrink: 0; }
      `}} />
      <div className="admin-gate-wrap">
        <div className="admin-gate-card">
          <div className="admin-gate-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <h1 className="admin-gate-title">Operations Console</h1>
          <p className="admin-gate-subtitle">Enter the access code to continue</p>
          <form id="admin-gate-form">
            <label className="admin-gate-label" htmlFor="admin-gate-code">Access code</label>
            <input
              className="admin-gate-input"
              type="password"
              id="admin-gate-code"
              name="code"
              autoComplete="off"
              autoFocus
              placeholder="••••••••"
              required
            />
            <div className="admin-gate-error" id="admin-gate-error">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span id="admin-gate-error-msg">Invalid code</span>
            </div>
            <button className="admin-gate-btn" type="submit" id="admin-gate-btn">Enter console</button>
          </form>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          var form = document.getElementById('admin-gate-form');
          if (!form) return;
          form.addEventListener('submit', function(e) {
            e.preventDefault();
            var code = document.getElementById('admin-gate-code').value.trim();
            var btn = document.getElementById('admin-gate-btn');
            var errorDiv = document.getElementById('admin-gate-error');
            var errorMsg = document.getElementById('admin-gate-error-msg');
            if (!code) return;
            btn.disabled = true;
            btn.textContent = 'Verifying\\u2026';
            errorDiv.classList.remove('show');
            fetch('/api/admin/gate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: code })
            }).then(function(res) {
              if (res.ok) {
                window.location.href = '/admin/ops';
              } else {
                return res.json().catch(function() { return {}; }).then(function(data) {
                  errorMsg.textContent = data.error || 'Invalid code';
                  errorDiv.classList.add('show');
                  btn.disabled = false;
                  btn.textContent = 'Enter console';
                });
              }
            }).catch(function() {
              errorMsg.textContent = 'Network error \\u2014 please try again';
              errorDiv.classList.add('show');
              btn.disabled = false;
              btn.textContent = 'Enter console';
            });
          });
        })();
      `}} />
    </>
  );
}