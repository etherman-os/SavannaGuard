const defaultConfig = {
  githubRepoUrl: "https://github.com/yourname/savannaguard",
  waitlistEndpoint: "",
  waitlistEmail: "",
};

const runtimeConfig = {
  ...defaultConfig,
  ...(window.SavannaPreviewConfig || {}),
};

const repoLink = document.getElementById("repo-link");
if (repoLink && runtimeConfig.githubRepoUrl) {
  repoLink.href = runtimeConfig.githubRepoUrl;
}

const form = document.getElementById("waitlist-form");
const statusEl = document.getElementById("form-status");
const submitBtn = document.getElementById("waitlist-submit");

function setStatus(message, type) {
  if (!statusEl) {
    return;
  }

  statusEl.textContent = message;
  statusEl.classList.remove("ok", "err");
  if (type) {
    statusEl.classList.add(type);
  }
}

function isConfiguredEmail(value) {
  if (!value) {
    return false;
  }

  const email = value.trim().toLowerCase();
  if (!email.includes("@")) {
    return false;
  }

  if (
    email.includes("example.com") ||
    email.includes("your-") ||
    email.includes("placeholder")
  ) {
    return false;
  }

  return true;
}

function toPayload(formData) {
  return {
    email: String(formData.get("email") || "").trim(),
    company: String(formData.get("company") || "").trim(),
    volume: String(formData.get("volume") || "").trim(),
    useCase: String(formData.get("useCase") || "").trim(),
    notes: String(formData.get("notes") || "").trim(),
    source: window.location.href,
    submittedAt: new Date().toISOString(),
  };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`request_failed_${response.status}`);
  }

  return response;
}

async function submitToConfiguredDestination(payload) {
  if (runtimeConfig.waitlistEndpoint) {
    await postJson(runtimeConfig.waitlistEndpoint, payload);
    return "endpoint";
  }

  if (isConfiguredEmail(runtimeConfig.waitlistEmail)) {
    const email = encodeURIComponent(runtimeConfig.waitlistEmail);
    await postJson(`https://formsubmit.co/ajax/${email}`, {
      ...payload,
      _subject: "SavannaGuard Preview Waitlist",
      _template: "table",
      _captcha: "false",
    });
    return "formsubmit";
  }

  const key = "savannaguard_preview_waitlist";
  const existing = JSON.parse(localStorage.getItem(key) || "[]");
  existing.push(payload);
  localStorage.setItem(key, JSON.stringify(existing));
  return "local";
}

if (form && submitBtn) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const honeypot = String(formData.get("website") || "").trim();

    if (honeypot) {
      setStatus("Gonderim kabul edilmedi.", "err");
      return;
    }

    if (!form.checkValidity()) {
      form.reportValidity();
      setStatus("Lutfen tum zorunlu alanlari doldurun.", "err");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Gonderiliyor...";
    setStatus("", "");

    try {
      const payload = toPayload(formData);
      const mode = await submitToConfiguredDestination(payload);

      if (mode === "endpoint") {
        setStatus("Talebiniz alindi. Davet acildiginda e-posta gonderecegiz.", "ok");
      } else if (mode === "formsubmit") {
        setStatus("On kaydiniz alindi. Kisa surede geri donus alacaksiniz.", "ok");
      } else {
        setStatus(
          "Preview modunda local kayit alindi. Canli toplama icin config.js dosyasinda endpoint veya e-posta tanimlayin.",
          "err"
        );
      }

      form.reset();
    } catch {
      setStatus("Gonderimde gecici bir hata oldu. Lutfen tekrar deneyin.", "err");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "On Kayit Gonder";
    }
  });
}

const revealNodes = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  revealNodes.forEach((node) => observer.observe(node));
} else {
  revealNodes.forEach((node) => node.classList.add("visible"));
}