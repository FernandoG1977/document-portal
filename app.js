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

async function loadRequirements(profile) {
  const select = $("requirementCode");

  if (!select || !profile) return;

  console.log("PERFIL CLIENTE:", profile);

  select.innerHTML =
    '<option value="">Selecciona un requisito</option>';

  // Obtener las reglas aplicables al perfil del cliente
  const { data: rules, error: rulesError } = await sb
    .from("requirement_rules")
    .select("requirement_code, requirement_level")
    .eq("person_type", profile.person_type)
    .eq("operation_type", profile.operation_type)
    .eq("process_type", profile.process_type);

  if (rulesError) {
    console.error("Error al cargar reglas:", rulesError);
    return;
  }

  // Resolver requisitos condicionales
  const applicableRules = rules.filter(rule => {

    if (rule.requirement_code === "REQ-12") {
      return profile.has_sector_registry === true;
    }

    if (rule.requirement_code === "REQ-15") {
      return (
        profile.has_immex === true ||
        profile.has_prosec === true ||
        profile.is_certified_company === true
      );
    }

    return rule.requirement_level !== "not_applicable";
  });

  const codes = applicableRules.map(rule => rule.requirement_code);

  if (!codes.length) return;

  // Obtener los nombres de los requisitos
  const { data: requirements, error: requirementsError } = await sb
    .from("document_requirements")
    .select("code, title, sort_order")
    .in("code", codes)
    .order("sort_order", { ascending: true });

  if (requirementsError) {
    console.error(
      "Error al cargar requisitos:",
      requirementsError
    );
    return;
  }

  requirements.forEach(item => {
    const rule = applicableRules.find(
      r => r.requirement_code === item.code
    );

    const option = document.createElement("option");
    option.value = item.code;

    const label =
      rule?.requirement_level === "optional"
        ? "Opcional"
        : "Obligatorio";

    option.textContent =
      `${item.code} - ${item.title} (${label})`;

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
  .select(`
  role,
  company,
  person_type,
  operation_type,
  process_type,
  has_sector_registry,
  has_immex,
  has_prosec,
  is_certified_company
`)
  .eq("id", session.user.id)
  .single();

if (!profileError && profile?.role === "client" && profile?.company) {
  $("clientName").value = profile.company;
  $("clientName").readOnly = true;
}
$("userEmail").textContent =
  session.user.email;

await loadRequirements(profile);
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

      if (recoveryMode) {
        return;
      }

      if (event === "SIGNED_OUT") {
        showForSession(null);
        return;
      }

      if (session) {
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


    const { data, error } =
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

  return;
}

if (data?.session) {

  status.textContent = "";

  await showForSession(data.session);
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

              requirement_code:
  String(
    formData.get("requirement_code") || ""
  ).trim(),

document_type:
  "Requisito documental",

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
    data: { user }
  } = await sb.auth.getUser();

  if (!user) return;


  /* ================================================
REQUISITOS YA CARGADOS EN EL PORTAL
================================================ */

const requirementSelect =
  $("requirementCode");

const requirements =
  [...requirementSelect.options]
    .filter(option => option.value)
    .map(option => {

      const text =
        option.textContent.trim();

      const separator =
        text.indexOf(" - ");

      return {
        code: option.value,

        title:
          separator >= 0
            ? text.substring(separator + 3)
            : text
      };
    });


  /* ================================================
     DOCUMENTOS DEL CLIENTE
     ================================================ */

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


  const documents =
    !error && data
      ? data
      : [];


  /* ================================================
     RESUMEN DEL EXPEDIENTE
     ================================================ */

  let approvedCount = 0;
  let pendingCount = 0;
  let rejectedCount = 0;
  let missingCount = 0;


  $("requirementsChecklist").innerHTML =
    "";


  requirements.forEach(req => {

   const documentForRequirement =
  documents.find(
    doc =>
      doc.requirement_code ===
      req.code
  );

let state = "Falta cargar";
let stateClass = "state-missing";

if (documentForRequirement) {

  if (documentForRequirement.status === "approved") {

    state = "Aprobado";
    stateClass = "state-approved";
    approvedCount++;

  } else if (documentForRequirement.status === "rejected") {

  state = "Rechazado";
  stateClass = "state-rejected";
  rejectedCount++;

} else {

  state = "Pendiente de revisión";
  stateClass = "state-pending";
  pendingCount++;
}
} else {

  missingCount++;
}

const openRequirementButton =
  documentForRequirement
    ? `
      <a
        href="#"
        class="requirement-open">
        Abrir
      </a>
    `
    : "";

const row =
  document.createElement("div");

row.className = "requirement-row";

row.innerHTML = `
  <div class="requirement-code">${escapeHtml(req.code)}</div>
  <div>${escapeHtml(req.title)}</div>
  <div class="requirement-actions">
    <span class="requirement-state ${stateClass}">${escapeHtml(state)}</span>
    ${openRequirementButton}
  </div>
`;
    
const requirementOpen =
  row.querySelector(".requirement-open");

if (
  requirementOpen &&
  documentForRequirement
) {

  requirementOpen.addEventListener(
    "click",
    async e => {

      e.preventDefault();

      const {
        data: signed,
        error: signedError
      } =
        await sb.storage
          .from(BUCKET)
          .createSignedUrl(
            documentForRequirement.file_path,
            60
          );

      if (signedError || !signed) {

        alert(
          "No fue posible abrir el documento."
        );

        return;
      }

      window.open(
        signed.signedUrl,
        "_blank"
      );
    }
  );
}

$("requirementsChecklist")
  .appendChild(row);
  });
const requirementOpen =
  row.querySelector(".requirement-open");

if (
  requirementOpen &&
  documentForRequirement
) {

  requirementOpen.addEventListener(
    "click",
    async e => {

      e.preventDefault();

      const {
        data: signed,
        error: signedError
      } =
        await sb.storage
          .from(BUCKET)
          .createSignedUrl(
            documentForRequirement.file_path,
            60
          );

      if (signedError || !signed) {
        alert(
          "No fue posible abrir el documento."
        );
        return;
      }

      window.open(
        signed.signedUrl,
        "_blank"
      );
    }
  );
}

 $("totalRequirements").textContent =
requirements.length;

$("approvedRequirements").textContent =
approvedCount;

$("pendingRequirements").textContent =
pendingCount;

$("rejectedRequirements").textContent =
rejectedCount;

$("missingRequirements").textContent =
missingCount;


  /* ================================================
     TABLA DE DOCUMENTOS
     ================================================ */

  $("myRows").innerHTML = "";


  if (!documents.length) {

    $("myEmpty").style.display =
      "block";

    return;
  }


  $("myEmpty").style.display =
    "none";


  documents.forEach(item => {

    const tr =
      document.createElement("tr");


    const requirement =
      item.requirement_code ||
      item.document_type ||
      "—";


    const status =
      item.status === "approved"
        ? "Aprobado"
        : item.status === "rejected"
          ? "Rechazado"
          : "Pendiente";


    const observations =
      item.review_comments || "—";


    const replaceButton =
      item.status === "rejected"
        ? `
          <button
            type="button"
            class="replace-btn">
            Reemplazar
          </button>
        `
        : "";


    tr.innerHTML = `
      <td>
        ${formatDate(item.created_at)}
      </td>

      <td>
        ${escapeHtml(item.reference)}
      </td>

      <td>
        ${escapeHtml(requirement)}
      </td>

      <td>
        ${escapeHtml(item.original_name)}
      </td>

      <td>
        <strong>
          ${escapeHtml(status)}
        </strong>
      </td>

      <td>
        ${escapeHtml(observations)}
      </td>

      <td>
        <a
          href="#"
          class="action-link open-link">
          Abrir
        </a>

        ${replaceButton}

        <input
          type="file"
          class="replace-file hidden"
          accept=".pdf,.xml,.xlsx,.xls,.docx,.doc,.jpg,.jpeg,.png"
        >
      </td>
    `;


    tr
      .querySelector(".open-link")
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


    const replaceBtn =
      tr.querySelector(
        ".replace-btn"
      );


    const replaceInput =
      tr.querySelector(
        ".replace-file"
      );


    if (
      replaceBtn &&
      replaceInput
    ) {

      replaceBtn.addEventListener(
        "click",
        () => {

          replaceInput.click();
        }
      );


      replaceInput.addEventListener(
        "change",
        async () => {

          const file =
            replaceInput.files?.[0];


          if (!file) return;


          const ok =
            confirm(
              `¿Reemplazar ${item.original_name} por ${file.name}?`
            );


          if (!ok) {

            replaceInput.value = "";

            return;
          }


          replaceBtn.disabled = true;

          replaceBtn.textContent =
            "Reemplazando...";


          const {
            error: uploadError
          } =
            await sb.storage
              .from(BUCKET)
              .upload(
                item.file_path,
                file,
                {
                  upsert: true,

                  contentType:
                    file.type ||
                    "application/octet-stream"
                }
              );


          if (uploadError) {

            alert(
              "No fue posible reemplazar el archivo: " +
              uploadError.message
            );


            replaceBtn.disabled = false;

            replaceBtn.textContent =
              "Reemplazar";


            return;
          }


          const {
            error: updateError
          } =
            await sb
              .from("documents")
              .update({

                original_name:
                  file.name,

                file_size:
                  file.size,

                mime_type:
                  file.type ||
                  null,

                status:
                  "pending",

                review_comments:
                  null,

                reviewed_by:
                  null,

                reviewed_at:
                  null
              })
              .eq(
                "id",
                item.id
              );


          if (updateError) {

            alert(
              "El archivo se reemplazó, pero no fue posible actualizar el estado: " +
              updateError.message
            );

            return;
          }


          alert(
            "Documento reemplazado correctamente. Quedó pendiente de revisión."
          );


          await loadMine();
        }
      );
    }


    $("myRows")
      .appendChild(tr);
  });
}

$("refreshBtn")?.addEventListener(
  "click",
  loadMine
);
