import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);

const escapeHtml = s =>
  String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));

const formatDate = value =>
  new Intl.DateTimeFormat("es-MX", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));

const safeFileName = name =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");

function isRecoveryLink() {
  return (
    window.location.hash.includes("type=recovery") ||
    window.location.search.includes("type=recovery")
  );
}

function showRecoveryForm() {
  const loginView = $("loginView");

  loginView.classList.remove("hidden");
  $("portalView").classList.add("hidden");
  $("logoutBtn").classList.add("hidden");

  loginView.innerHTML = `
    <div class="card auth-card">
      <p class="eyebrow">RECUPERACIÓN DE CONTRASEÑA</p>
      <h1>Nueva contraseña</h1>
      <p class="muted">
        Escribe y confirma la nueva contraseña que utilizarás para entrar al portal.
      </p>

      <form id="recoveryForm">
        <label>
          Nueva contraseña
          <input
            type="password"
            id="newPassword"
            minlength="8"
            required
          >
        </label>

        <label>
          Confirmar contraseña
          <input
            type="password"
            id="confirmPassword"
            minlength="8"
            required
          >
        </label>

        <button type="submit">Guardar nueva contraseña</button>

        <div id="recoveryStatus" class="status"></div>
      </form>
    </div>
  `;

  $("recoveryForm").addEventListener("submit", async e => {
    e.preventDefault();

    const password = $("newPassword").value;
    const confirm = $("confirmPassword").value;
    const status = $("recoveryStatus");

    status.className = "status";

    if (password.length < 8) {
      status.textContent = "La contraseña debe tener al menos 8 caracteres.";
      status.classList.add("error");
      return;
    }

    if (password !== confirm) {
      status.textContent = "Las contraseñas no coinciden.";
      status.classList.add("error");
      return;
    }

    status.textContent = "Guardando contraseña...";

    const { error } = await sb.auth.updateUser({
      password: password
    });

    if (error) {
      status.textContent = "No fue posible cambiar la contraseña: " + error.message;
      status.classList.add("error");
      return;
    }

    status.textContent = "✓ Contraseña actualizada correctamente.";
    status.classList.add("ok");

    setTimeout(async () => {
      await sb.auth.signOut();
      window.location.href =
        window.location.origin + window.location.pathname;
    }, 1800);
  });
}

async function showForSession(session) {
  if (isRecoveryLink()) {
    showRecoveryForm();
    return;
  }

  if (session) {
    $("loginView").classList.add("hidden");
    $("portalView").classList.remove("hidden");
    $("logoutBtn").classList.remove("hidden");
    $("userEmail").textContent = session.user.email;
    await loadMine();
  } else {
    $("loginView").classList.remove("hidden");
    $("portalView").classList.add("hidden");
    $("logoutBtn").classList.add("hidden");
    $("userEmail").textContent = "";
  }
}

sb.auth.onAuthStateChange((event, session) => {
  setTimeout(() => {
    if (event === "PASSWORD_RECOVERY") {
      showRecoveryForm();
    } else {
      showForSession(session);
    }
  }, 0);
});

const { data: { session } } = await sb.auth.getSession();

if (isRecoveryLink()) {
  showRecoveryForm();
} else {
  await showForSession(session);
}

$("loginForm")?.addEventListener("submit", async e => {
  e.preventDefault();

  const status = $("loginStatus");
  status.textContent = "Entrando...";
  status.className = "status";

  const { error } = await sb.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value
  });

  if (error) {
    status.textContent = "Correo o contraseña incorrectos.";
    status.classList.add("error");
  }
});

$("logoutBtn")?.addEventListener("click", async () => {
  await sb.auth.signOut();
});

$("documents")?.addEventListener("change", () => {
  $("fileList").innerHTML = "";

  [...$("documents").files].forEach(file => {
    const div = document.createElement("div");
    div.className = "file-item";

    div.innerHTML = `
      <span>${escapeHtml(file.name)}</span>
      <span>${(file.size / 1048576).toFixed(2)} MB</span>
    `;

    $("fileList").appendChild(div);
  });
});

$("uploadForm")?.addEventListener("submit", async e => {
  e.preventDefault();

  const { data: { user } } = await sb.auth.getUser();
  const files = [...$("documents").files];

  if (!files.length) {
    $("uploadStatus").textContent = "Selecciona al menos un documento.";
    $("uploadStatus").className = "status error";
    return;
  }

  $("submitBtn").disabled = true;
  $("uploadStatus").textContent = "Subiendo documentos...";
  $("uploadStatus").className = "status";

  try {
    const formData = new FormData(e.target);

    for (const file of files) {
      const path =
        `${user.id}/${Date.now()}-${crypto.randomUUID()}-${safeFileName(file.name)}`;

      const { error: uploadError } =
        await sb.storage.from(BUCKET).upload(path, file, {
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { error: databaseError } =
        await sb.from("documents").insert({
          user_id: user.id,
          user_email: user.email,
          client_name: String(formData.get("client_name")).trim(),
          reference: String(formData.get("reference")).trim(),
          document_type: String(formData.get("document_type")),
          comments: String(formData.get("comments") || ""),
          file_path: path,
          original_name: file.name,
          file_size: file.size,
          mime_type: file.type || null
        });

      if (databaseError) throw databaseError;
    }

    $("uploadStatus").textContent =
      `✓ ${files.length} documento(s) cargado(s) correctamente.`;

    $("uploadStatus").className = "status ok";

    e.target.reset();
    $("fileList").innerHTML = "";

    await loadMine();

  } catch (error) {
    $("uploadStatus").textContent =
      "Error al cargar los documentos: " + error.message;

    $("uploadStatus").className = "status error";

  } finally {
    $("submitBtn").disabled = false;
  }
});

async function loadMine() {
  const { data, error } =
    await sb
      .from("documents")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

  $("myRows").innerHTML = "";

  if (error || !data.length) {
    $("myEmpty").style.display = "block";
    return;
  }

  $("myEmpty").style.display = "none";

  data.forEach(document => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${formatDate(document.created_at)}</td>
      <td>${escapeHtml(document.reference)}</td>
      <td>${escapeHtml(document.document_type)}</td>
      <td>${escapeHtml(document.original_name)}</td>
      <td>
        <a href="#" class="action-link">Abrir</a>
      </td>
    `;

    tr.querySelector("a").addEventListener("click", async e => {
      e.preventDefault();

      const { data: signed } =
        await sb.storage
          .from(BUCKET)
          .createSignedUrl(document.file_path, 60);

      if (signed) {
        window.open(signed.signedUrl, "_blank");
      }
    });

    $("myRows").appendChild(tr);
  });
}

$("refreshBtn")?.addEventListener("click", loadMine);
