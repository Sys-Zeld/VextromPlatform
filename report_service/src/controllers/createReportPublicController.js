const nodemailer = require("nodemailer");
const repo = require("../repositories/serviceReportRepository");
const service = require("../services/serviceReportService");
const { renderReportPreviewHtml } = require("../services/reportTemplateService");
const { getReportConfigSettings } = require("../services/reportConfigSettings");
const { getReportServiceEmailSettings, getTemplateByPurpose } = require("../services/emailSettings");
const crypto = require("crypto");
const env = require("../../../specflow/config/env");

function createReportPublicController(deps) {
  const sanitizeInput = deps.sanitizeInput;
  const EMAIL_PROOF_COOKIE = "sr_sign_email_proof";

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function buildEmailProof(signRequest) {
    const secret = String(
      process.env.SERVICE_REPORT_SIGN_EMAIL_SECRET
      || process.env.SESSION_SECRET
      || "service-report-sign-email-proof"
    );
    const payload = `${signRequest.id}|${signRequest.token}|${normalizeEmail(signRequest.signer_email)}`;
    const digest = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    return `${signRequest.id}.${digest}`;
  }

  function hasValidEmailProof(req, signRequest) {
    const cookieValue = String((req.cookies && req.cookies[EMAIL_PROOF_COOKIE]) || "");
    return cookieValue && cookieValue === buildEmailProof(signRequest);
  }

  function setEmailProofCookie(res, signRequest) {
    res.cookie(EMAIL_PROOF_COOKIE, buildEmailProof(signRequest), {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 30 * 60 * 1000
    });
  }

  function clearEmailProofCookie(res) {
    res.clearCookie(EMAIL_PROOF_COOKIE, { sameSite: "lax" });
  }

  function parseEmailList(raw) {
    return String(raw || "")
      .split(/[;,\r\n]+/)
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  function isValidEmailAddress(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
  }

  function sanitizeSubjectHeaderValue(value) {
    return String(value || "").replace(/[\r\n]+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderEmailPlaceholder(template, variables) {
    return String(template || "").replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (match, key) => {
      const normalizedKey = String(key || "").trim().toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(variables, normalizedKey)) return match;
      return escapeHtml(String(variables[normalizedKey] || ""));
    });
  }

  function buildSignedReportTemplateVariables(signRequest, signedLink) {
    return {
      os_codigo: signRequest.service_order_code || signRequest.order_title || `OS-${signRequest.order_id || ""}`,
      relatorio_numero: String(signRequest.report_number || ""),
      cliente: signRequest.customer_name || "",
      local: "",
      link_relatorio: signedLink || ""
    };
  }

  function resolveRequestBaseUrl(req) {
    const host = String((req.get && req.get("host")) || req.headers.host || "").trim();
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const protocol = forwardedProto || req.protocol || "http";
    if (host) return `${protocol}://${host}`;
    return String(env.appBaseUrl || "http://localhost:3000").replace(/\/+$/, "");
  }

  return {
    async clientSignedReportPage(req, res) {
      const token = sanitizeInput(String(req.params.token || "")).trim();
      if (!token) return res.status(404).send("Link invalido.");

      const signRequest = await repo.getSignRequestByToken(token);
      if (!signRequest) return res.status(404).send("Link nao encontrado.");
      const status = String(signRequest.status || "").toLowerCase();
      if (status === "pending" && !hasValidEmailProof(req, signRequest)) {
        return res.redirect(`/r/sign/${token}?require_email=1`);
      }
      if (!["pending", "signed"].includes(status)) {
        return res.redirect(`/r/sign/${token}`);
      }

      const report = await repo.getReportById(signRequest.service_report_id);
      const payload = await service.buildReportAggregate(report.id);
      const reportConfig = await getReportConfigSettings();
      const reportHtml = await renderReportPreviewHtml(payload, { reportConfig });
      const pageTitle = `Relatorio ${signRequest.report_number || ""}`.trim()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      const cv = Date.now();
      const autoPrint = req.query.print === "1";
      return res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=850, initial-scale=1.0" />
  <title>${pageTitle || "Relatorio assinado"}</title>
  <link href="/public/css/report-preview.css" rel="stylesheet" />
  <link href="/public/css/report-print.css" rel="stylesheet" />
  <style>
    .report-print-btn {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 9999;
      padding: 10px 20px;
      background: #4f7d33;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .report-print-btn:hover { background: #3d6228; }
    @media print { .report-print-btn { display: none !important; } }
  </style>
</head>
<body>
<button class="report-print-btn" onclick="window.print()">&#128424; Imprimir</button>
${reportHtml}
<script src="/public/js/report-pagination.js?v=${cv}"></script>${autoPrint ? `
<script>
(function () {
  function tryPrint() {
    if (window.__reportPaginationDone) { window.print(); return; }
    var attempts = 0;
    var t = setInterval(function () {
      attempts++;
      if (window.__reportPaginationDone || attempts > 30) {
        clearInterval(t);
        window.print();
      }
    }, 100);
  }
  if (document.readyState === "complete") { setTimeout(tryPrint, 200); }
  else { window.addEventListener("load", function () { setTimeout(tryPrint, 200); }); }
})();
</script>` : ""}
</body>
</html>`);
    },

    async clientSignPage(req, res) {
      const token = sanitizeInput(String(req.params.token || "")).trim();
      if (!token) return res.status(404).send("Link invalido.");

      const signRequest = await repo.getSignRequestByToken(token);
      if (!signRequest) {
        return res.status(404).render("report-service/client-sign", {
          signRequest: null,
          reportHtml: null,
          alreadySigned: false,
          expired: false,
          cancelled: false,
          notFound: true,
          justSigned: false,
          pageTitle: "Assinatura de Relatorio"
        });
      }

      const justSigned = req.query.signed === "1";
      const emailMismatch = req.query.email_mismatch === "1";
      const refused = req.query.refused === "1";
      const emailSent = req.query.email_sent === "1";
      const emailErrorKey = sanitizeInput(req.query.email_error).toLowerCase();
      const emailErrorMap = {
        invalid_to: "Informe ao menos 1 destinatario valido no campo Para.",
        invalid_cc: "Existe e-mail invalido no campo CC.",
        smtp: "Configuracao SMTP indisponivel no modulo Service Report.",
        send_failed: "Falha ao enviar o e-mail com o relatorio assinado.",
        not_signed: "O envio por e-mail so e permitido para documento assinado.",
        token_not_found: "Nao foi possivel gerar o link assinado do relatorio."
      };
      const now = new Date();
      const expiresAt = new Date(signRequest.expires_at);

      if (signRequest.status === "signed") {
        const report = await repo.getReportById(signRequest.service_report_id);
        const payload = await service.buildReportAggregate(report.id);
        const reportConfig = await getReportConfigSettings();
        const reportHtml = await renderReportPreviewHtml(payload, { reportConfig });
        return res.render("report-service/client-sign", {
          signRequest,
          reportHtml,
          alreadySigned: true,
          expired: false,
          cancelled: false,
          notFound: false,
          justSigned,
          emailSent,
          emailError: emailErrorMap[emailErrorKey] || "",
          pageTitle: "Relatorio - Assinatura"
        });
      }

      if (signRequest.status === "cancelled") {
        return res.render("report-service/client-sign", {
          signRequest,
          reportHtml: null,
          alreadySigned: false,
          expired: false,
          cancelled: true,
          notFound: false,
          justSigned: false,
          emailMismatch,
          refused,
          pageTitle: "Relatorio - Assinatura"
        });
      }

      if (now > expiresAt) {
        await repo.updateSignRequest(signRequest.id, { status: "expired" });
        return res.render("report-service/client-sign", {
          signRequest,
          reportHtml: null,
          alreadySigned: false,
          expired: true,
          cancelled: false,
          notFound: false,
          justSigned: false,
          pageTitle: "Relatorio - Assinatura"
        });
      }

      const expectedEmail = normalizeEmail(signRequest.signer_email);
      if (!expectedEmail) {
        await repo.updateSignRequest(signRequest.id, {
          status: "cancelled",
          notes: "Cancelado automaticamente: signatario sem email cadastrado para verificacao."
        });
        clearEmailProofCookie(res);
        return res.redirect(`/r/sign/${token}?email_mismatch=1`);
      }

      if (!hasValidEmailProof(req, signRequest)) {
        return res.render("report-service/client-sign", {
          signRequest,
          reportHtml: null,
          alreadySigned: false,
          expired: false,
          cancelled: false,
          notFound: false,
          justSigned: false,
          requireEmail: true,
          emailMismatch,
          signError: req.query.error || null,
          pageTitle: `Relatorio ${signRequest.report_number || ""} - Assinatura`
        });
      }

      const report = await repo.getReportById(signRequest.service_report_id);
      const payload = await service.buildReportAggregate(report.id);
      const reportConfig = await getReportConfigSettings();
      const reportHtml = await renderReportPreviewHtml(payload, { reportConfig });

      return res.render("report-service/client-sign", {
        signRequest,
        reportHtml,
        alreadySigned: false,
        expired: false,
        cancelled: false,
        notFound: false,
        justSigned: false,
        requireEmail: false,
        emailMismatch: false,
        refused: false,
        signError: req.query.error || null,
        pageTitle: `Relatorio ${signRequest.report_number || ""} - Assinatura`
      });
    },

    async clientVerifyEmail(req, res) {
      const token = sanitizeInput(String(req.params.token || "")).trim();
      if (!token) return res.status(400).send("Token invalido.");

      const signRequest = await repo.getSignRequestByToken(token);
      if (!signRequest) return res.status(404).send("Link nao encontrado.");

      const now = new Date();
      if (signRequest.status !== "pending") {
        return res.redirect(`/r/sign/${token}`);
      }
      if (now > new Date(signRequest.expires_at)) {
        await repo.updateSignRequest(signRequest.id, { status: "expired" });
        return res.redirect(`/r/sign/${token}`);
      }

      const informedEmail = normalizeEmail(req.body && req.body.signer_email);
      const expectedEmail = normalizeEmail(signRequest.signer_email);
      if (!expectedEmail || informedEmail !== expectedEmail) {
        await repo.updateSignRequest(signRequest.id, {
          status: "cancelled",
          notes: `Cancelado por divergencia de email. Informado: ${informedEmail || "-"}`
        });
        clearEmailProofCookie(res);
        return res.redirect(`/r/sign/${token}?email_mismatch=1`);
      }

      setEmailProofCookie(res, signRequest);
      return res.redirect(`/r/sign/${token}`);
    },

    async clientSubmitSign(req, res) {
      const token = sanitizeInput(String(req.params.token || "")).trim();
      if (!token) return res.status(400).send("Token invalido.");

      const signRequest = await repo.getSignRequestByToken(token);
      if (!signRequest) return res.status(404).send("Link nao encontrado.");

      const now = new Date();
      if (signRequest.status !== "pending") {
        return res.status(400).send("Este link ja foi utilizado ou cancelado.");
      }
      if (now > new Date(signRequest.expires_at)) {
        return res.status(400).send("Link expirado.");
      }
      if (!hasValidEmailProof(req, signRequest)) {
        return res.redirect(`/r/sign/${token}?require_email=1`);
      }

      const signatureData = String(req.body.signature_data || "").trim();
      if (!signatureData || signatureData === "data:,") {
        return res.redirect(`/r/sign/${token}?error=nosig`);
      }
      const signerName = sanitizeInput(req.body.signer_name).trim();
      const signerRole = sanitizeInput(req.body.signer_role).trim();
      const signerCompany = sanitizeInput(req.body.signer_company).trim();
      if (!signerName) {
        return res.redirect(`/r/sign/${token}?error=signer_required`);
      }

      const ipAddress = String(
        req.headers["x-forwarded-for"] || req.ip || ""
      ).split(",")[0].trim().slice(0, 100);

      await repo.updateSignRequest(signRequest.id, {
        signerName,
        signerRole,
        signerCompany,
        status: "signed",
        signatureData,
        signedAt: new Date().toISOString(),
        ipAddress
      });

      await service.createSignature(signRequest.service_report_id, {
        signerType: "customer_responsible",
        signerName,
        signerRole,
        signerCompany,
        signatureData
      });

      clearEmailProofCookie(res);
      return res.redirect(`/r/sign/${token}?signed=1`);
    },

    async clientRefuseSign(req, res) {
      const token = sanitizeInput(String(req.params.token || "")).trim();
      if (!token) return res.status(400).send("Token invalido.");

      const signRequest = await repo.getSignRequestByToken(token);
      if (!signRequest) return res.status(404).send("Link nao encontrado.");

      const now = new Date();
      if (signRequest.status !== "pending") {
        return res.redirect(`/r/sign/${token}`);
      }
      if (now > new Date(signRequest.expires_at)) {
        await repo.updateSignRequest(signRequest.id, { status: "expired" });
        return res.redirect(`/r/sign/${token}`);
      }
      if (!hasValidEmailProof(req, signRequest)) {
        return res.redirect(`/r/sign/${token}?require_email=1`);
      }

      const refusalNote = String(req.body.refusal_note || "").trim();
      if (!refusalNote) {
        return res.redirect(`/r/sign/${token}?error=refusal_note`);
      }

      await repo.updateSignRequest(signRequest.id, {
        status: "cancelled",
        notes: `RECUSA: ${refusalNote}`
      });

      try {
        const order = await repo.getOrderById(signRequest.order_id);
        const systemUser = String(order && (order.created_by || order.updated_by) || "").trim() || "system";
        await service.updateOrder(signRequest.order_id, {
          status: "waiting_review",
          updatedBy: systemUser
        });
      } catch (_err) {
        // keep sign request cancelled even if order update fails
      }

      clearEmailProofCookie(res);
      return res.redirect(`/r/sign/${token}?refused=1`);
    },

    async clientSendSignedEmail(req, res) {
      const token = sanitizeInput(String(req.params.token || "")).trim();
      if (!token) return res.status(400).send("Token invalido.");

      const signRequest = await repo.getSignRequestByToken(token);
      if (!signRequest) return res.status(404).send("Link nao encontrado.");
      if (String(signRequest.status || "").toLowerCase() !== "signed") {
        return res.redirect(`/r/sign/${token}?email_error=not_signed`);
      }

      const to = parseEmailList(req.body.to);
      const cc = parseEmailList(req.body.cc);
      if (!to.length || to.some((item) => !isValidEmailAddress(item))) {
        return res.redirect(`/r/sign/${token}?email_error=invalid_to`);
      }
      if (cc.some((item) => !isValidEmailAddress(item))) {
        return res.redirect(`/r/sign/${token}?email_error=invalid_cc`);
      }

      const emailSettings = await getReportServiceEmailSettings();
      if (!emailSettings.smtp || !emailSettings.smtp.host || !emailSettings.smtp.from) {
        return res.redirect(`/r/sign/${token}?email_error=smtp`);
      }

      try {
        const transporter = nodemailer.createTransport({
          host: emailSettings.smtp.host,
          port: emailSettings.smtp.port,
          secure: emailSettings.smtp.secure,
          auth: emailSettings.smtp.user
            ? { user: emailSettings.smtp.user, pass: emailSettings.smtp.pass }
            : undefined
        });

        const signedLink = `${resolveRequestBaseUrl(req)}/r/signed/${encodeURIComponent(token)}`;
        const reportNumber = String(signRequest.report_number || "").trim();
        const orderLabel = String(signRequest.service_order_code || signRequest.order_title || "").trim();
        const signedTemplate = getTemplateByPurpose(
          emailSettings.emailTemplates,
          emailSettings.defaultTemplateId,
          "relatorio_assinado"
        );
        const signedVars = buildSignedReportTemplateVariables(signRequest, signedLink);
        const subject = sanitizeSubjectHeaderValue(
          signedTemplate && signedTemplate.subject
            ? renderEmailPlaceholder(signedTemplate.subject, signedVars)
            : `Relatorio assinado ${reportNumber || orderLabel || "Service Report"}`
        );
        const customMessage = sanitizeInput(req.body.message || "");
        let htmlBody;
        if (signedTemplate && signedTemplate.html) {
          htmlBody = `<!doctype html><html><body>${renderEmailPlaceholder(signedTemplate.html, signedVars)}</body></html>`;
        } else {
          const bodyIntro = customMessage
            ? `<p style="margin:0 0 12px 0;">${customMessage}</p>`
            : "<p style=\"margin:0 0 12px 0;\">Seu relatorio assinado esta disponivel no link abaixo para visualizacao e impressao.</p>";
          htmlBody = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1f2937;">${bodyIntro}<p style="margin:0 0 8px 0;"><strong>Relatorio:</strong> ${reportNumber || "-"}</p><p style="margin:0 0 8px 0;"><strong>OS:</strong> ${orderLabel || "-"}</p><p style="margin:0 0 8px 0;"><strong>Cliente:</strong> ${signRequest.customer_name || "-"}</p><p style="margin:16px 0;"><a href="${escapeHtml(signedLink)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#14532d;color:#fff;text-decoration:none;font-weight:600;">Abrir relatorio assinado</a></p><p style="margin:12px 0 0 0;color:#6b7280;font-size:12px;">E-mail enviado pelo link de assinatura eletrônica.</p></body></html>`;
        }

        await transporter.sendMail({
          from: emailSettings.smtp.from,
          to,
          cc: cc.length ? cc : undefined,
          subject,
          html: htmlBody
        });

        return res.redirect(`/r/sign/${token}?email_sent=1`);
      } catch (_err) {
        // eslint-disable-next-line no-console
        console.error("[report-service] Falha ao enviar e-mail com relatorio assinado (link publico).", _err);
        return res.redirect(`/r/sign/${token}?email_error=send_failed`);
      }
    }
  };
}

module.exports = { createReportPublicController };
