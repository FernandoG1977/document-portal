import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);

let recoveryMode = false;

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

async function loadRequirements() {
  const select = $("requirementCode");

  if (!select) return;

  select.innerHTML = '<option value="">Selecciona un requisito</option>';

  const { data, error } = await sb
    .from("document_requirements")
    .select("code, title, category, sort_order")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Error al cargar requisitos:", error);
    return;
  }

  data.forEach(item => {
    const option = document.createElement("option");
    option.value = item.code;
    option.textContent = `${item.code} - ${item.title}`;
    select.appendChild(option);
  });
}

/* ================================================
   RECUPERACIÓN DE CONTRASEÑA
   ====================================================== */

async function establishRecoverySession() {

  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(
    window.location.hash.startsWith("#")
      ? window.location.hash.substring(1)
      : window.location.hash
  );

  const type =
    query.get("type") ||
    hash.get("type");

  const code = query.get("code");

  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");

  const recoveryDetected =
    type === "recovery" ||
    !!code ||
    (!!accessToken && !!refreshToken);

  if (!recoveryDetected) {
    return {
      recovery: false,
      session: null,
      error: null
    };
  }

  recoveryMode = true;

  /*
   * Método PKCE:
   * Supabase devuelve ?code=...
   */
  if (code) {

    const { data, error } =
      await sb.auth.exchangeCodeForSession(code);

    if (error) {
      return {
        recovery: true,
        session: null,
        error
      };
    }

    return {
      recovery: true,
      session: data.session,
      error: null
    };
  }


  /*
   * Método con access_token y refresh_token
   */
  if (accessToken && refreshToken) {

    const { data, error } =
      await sb.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });

    if (error) {
      return {
        recovery: true,
        session: null,
        error
      };
    }

    return {
      recovery: true,
      session: data.session,
      error: null
    };
  }


  /*
   * Si Supabase ya procesó automáticamente
   * el enlace, recuperamos la sesión actual.
   */
  const {
    data: { session },
    error
  } = await sb.auth.getSession();

  return {
    recovery: true,
    session,
    error
  };
}


function showRecoveryError(message) {

  $("loginView").classList.remove("hidden");
  $("portalView").classList.add("hidden");
  $("logoutBtn").classList.add("hidden");

  $("loginView").innerHTML = `
    <div class="card auth-card">

      <p class="eyebrow">
        RECUPERACIÓN DE CONTRASEÑA
      </p>

      <h1>Enlace no válido</h1>

      <p class="muted">
        El enlace de recuperación ya expiró,
        fue utilizado anteriormente o no pudo
        establecer una sesión segura.
      </p>

      <div class="status error">
        ${escapeHtml(message || "Solicita un nuevo correo de recuperación.")}
      </div>

    </div>
  `;
}


function showRecoveryForm() {

  $("loginView").classList.remove("hidden");
  $("portalView").classList.add("hidden");
  $("logoutBtn").classList.add("hidden");

  $("loginView").innerHTML = `
    <div class="card auth-card">

      <p class="eyebrow">
        RECUPERACIÓN DE CONTRASEÑA
      </p>

      <h1>Nueva contraseña</h1>

      <p class="muted">
        Escribe y confirma la nueva contraseña
        que utilizarás para entrar al portal.
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

        <button type="submit">
          Guardar nueva contraseña
        </button>

        <div
          id="recoveryStatus"
          class="status">
        </div>

      </form>

    </div>
  `;


  $("recoveryForm").addEventListener(
    "submit",
    async e => {

      e.preventDefault();

      const password =
        $("newPassword").value;

      const confirm =
        $("confirmPassword").value;

      const status =
        $("recoveryStatus");

      status.className = "status";


      if (password.length < 8) {

        status.textContent =
          "La contraseña debe tener al menos 8 caracteres.";

        status.classList.add("error");

        return;
      }


      if (password !== confirm) {

        status.textContent =
          "Las contraseñas no coinciden.";

        status.classList.add("error");

        return;
      }


      status.textContent =
        "Guardando nueva contraseña...";


      /*
       * Confirmamos que exista una sesión
       * antes de cambiar la contraseña.
       */
      const {
        data: { session }
      } = await sb.auth.getSession();


      if (!session) {

        status.textContent =
          "La sesión de recuperación no está disponible. Solicita un nuevo correo de recuperación.";

        status.classList.add("error");

        return;
      }


      const { error } =
        await sb.auth.updateUser({
          password
        });


      if (error) {

        status.textContent =
          "No fue posible cambiar la contraseña: " +
          error.message;

        status.classList.add("error");

        return;
      }


      status.textContent =
        "✓ Contraseña actualizada correctamente.";

      status.classList.add("ok");


      recoveryMode = false;


      setTimeout(async () => {

        await sb.auth.signOut();

        window.location.href =
          window.location.origin +
          window.location.pathname;

      }, 2000);

    }
  );
}


/* ======================================================
   SESIÓN NORMAL
   ====================================================== */

async function showForSession(session) {

  if (recoveryMode) {
    return;
  }


  if (session) {

    $("loginView").classList.add("hidden");

    $("portalView").classList.remove("hidden");

    $("logoutBtn").classList.remove("hidden");

    $("userEmail").textContent =
  session.user.email;

const { data: profile, error: profileError } = await sb
  .from("profiles")
  .select("role, company")
  .eq("id", session.user.id)
  .single();

if (!profileError && profile?.role === "client" && profile?.company) {
  $("clientName").value = profile.company;
  $("clientName").readOnly = true;
}
$("userEmail").textContent =
  session.user.email;

await loadRequirements();
await loadMine();

  } else {

    $("loginView").classList.remove("hidden");

    $("portalView").classList.add("hidden");

    $("logoutBtn").classList.add("hidden");

    $("userEmail").textContent = "";
  }
}


/* ======================================================
   INICIALIZACIÓN
   ====================================================== */

const recovery =
  await establishRecoverySession();


if (recovery.recovery) {

  if (
    recovery.error ||
    !recovery.session
  ) {

    showRecoveryError(
      recovery.error?.message
    );

  } else {

    showRecoveryForm();
  }

} else {

  const {
    data: { session }
  } = await sb.auth.getSession();

  await showForSession(session);
}


/*
 * Detecta cambios posteriores de autenticación.
 */
sb.auth.onAuthStateChange(
  (event, session) => {

    setTimeout(() => {

      if (event === "PASSWORD_RECOVERY") {

        recoveryMode = true;

        showRecoveryForm();

        return;
      }


      if (!recoveryMode) {
        showForSession(session);
      }

    }, 0);
  }
);


/* ======================================================
   LOGIN
   ====================================================== */

$("loginForm")?.addEventListener(
  "submit",
  async e => {

    e.preventDefault();

    const status =
      $("loginStatus");

    status.textContent =
      "Entrando...";

    status.className =
      "status";


    const { error } =
      await sb.auth.signInWithPassword({

        email:
          $("email").value.trim(),

        password:
          $("password").value
      });


    if (error) {

      status.textContent =
        "Correo o contraseña incorrectos.";

      status.classList.add("error");
    }
  }
);


/* ======================================================
   CERRAR SESIÓN
   ====================================================== */

$("logoutBtn")?.addEventListener(
  "click",
  async () => {

    await sb.auth.signOut();
  }
);


/* ======================================================
   MOSTRAR ARCHIVOS SELECCIONADOS
   ====================================================== */

$("documents")?.addEventListener(
  "change",
  () => {

    $("fileList").innerHTML = "";

    [...$("documents").files]
      .forEach(file => {

        const div =
          document.createElement("div");

        div.className =
          "file-item";

        div.innerHTML = `
          <span>
            ${escapeHtml(file.name)}
          </span>

          <span>
            ${(file.size / 1048576).toFixed(2)} MB
          </span>
        `;

        $("fileList")
          .appendChild(div);
      });
  }
);


/* ======================================================
   SUBIR DOCUMENTOS
   ====================================================== */

$("uploadForm")?.addEventListener(
  "submit",
  async e => {

    e.preventDefault();


    const {
      data: { user }
    } = await sb.auth.getUser();


    const files =
      [...$("documents").files];


    if (!files.length) {

      $("uploadStatus").textContent =
        "Selecciona al menos un documento.";

      $("uploadStatus").className =
        "status error";

      return;
    }


    $("submitBtn").disabled = true;

    $("uploadStatus").textContent =
      "Subiendo documentos...";

    $("uploadStatus").className =
      "status";


    try {

      const formData =
        new FormData(e.target);


      for (const file of files) {

        const path =
          `${user.id}/${Date.now()}-${crypto.randomUUID()}-${safeFileName(file.name)}`;


        const {
          error: uploadError
        } =
          await sb.storage
            .from(BUCKET)
            .upload(
              path,
              file,
              {
                upsert: false
              }
            );


        if (uploadError) {
          throw uploadError;
        }


        const {
          error: databaseError
        } =
          await sb
            .from("documents")
            .insert({

              user_id:
                user.id,

              user_email:
                user.email,

              client_name:
                String(
                  formData.get("client_name")
                ).trim(),

              reference:
                String(
                  formData.get("reference")
                ).trim(),

              document_type:
                String(
                  formData.get("document_type")
                ),

              comments:
                String(
                  formData.get("comments") || ""
                ),

              file_path:
                path,

              original_name:
                file.name,

              file_size:
                file.size,

              mime_type:
                file.type || null
            });


        if (databaseError) {
          throw databaseError;
        }
      }


      $("uploadStatus").textContent =
        `✓ ${files.length} documento(s) cargado(s) correctamente.`;


      $("uploadStatus").className =
        "status ok";


      e.target.reset();

      $("fileList").innerHTML = "";


      await loadMine();


    } catch (error) {

      $("uploadStatus").textContent =
        "Error al cargar los documentos: " +
        error.message;


      $("uploadStatus").className =
        "status error";


    } finally {

      $("submitBtn").disabled = false;
    }
  }
);


/* ======================================================
   CONSULTAR DOCUMENTOS
   ====================================================== */

async function loadMine() {

  const {
    data,
    error
  } =
    await sb
      .from("documents")
      .select("*")
      .order(
        "created_at",
        {
          ascending: false
        }
      )
      .limit(100);


  $("myRows").innerHTML = "";


  if (
    error ||
    !data ||
    !data.length
  ) {

    $("myEmpty").style.display =
      "block";

    return;
  }


  $("myEmpty").style.display =
    "none";


  data.forEach(item => {

    const tr =
      document.createElement("tr");


    tr.innerHTML = `

      <td>
        ${formatDate(item.created_at)}
      </td>

      <td>
        ${escapeHtml(item.reference)}
      </td>

      <td>
        ${escapeHtml(item.document_type)}
      </td>

      <td>
        ${escapeHtml(item.original_name)}
      </td>

      <td>
        <a
          href="#"
          class="action-link">
          Abrir
        </a>
      </td>
    `;


    tr.querySelector("a")
      .addEventListener(
        "click",
        async e => {

          e.preventDefault();


          const {
            data: signed
          } =
            await sb.storage
              .from(BUCKET)
              .createSignedUrl(
                item.file_path,
                60
              );


          if (signed) {

            window.open(
              signed.signedUrl,
              "_blank"
            );
          }
        }
      );


    $("myRows")
      .appendChild(tr);
  });
}


$("refreshBtn")?.addEventListener(
  "click",
  loadMine
);
