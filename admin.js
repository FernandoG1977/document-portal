import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);

let docs = [];

const esc = s =>
  String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));

const fmt = value =>
  value
    ? new Intl.DateTimeFormat("es-MX", {
        dateStyle: "short",
        timeStyle: "short"
      }).format(new Date(value))
    : "—";

function statusLabel(status) {
  if (status === "approved") return "Aprobado";
  if (status === "rejected") return "Rechazado";
  return "Pendiente";
}

async function isAdmin(userId) {
  const { data, error } = await sb
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  return !error && data?.role === "admin";
}

async function showView(session) {






  
  if (!session) {
    $("adminLogin").classList.remove("hidden");
    $("adminView").classList.add("hidden");
    $("logoutBtn").classList.add("hidden");
    $("adminEmail").textContent = "";
    return;
  }

  const allowed = await isAdmin(session.user.id);

  if (!allowed) {
  $("adminLogin").classList.remove("hidden");
  $("adminView").classList.add("hidden");
  $("logoutBtn").classList.add("hidden");

  $("loginStatus").textContent =
    "Esta cuenta no tiene permisos de administrador.";

  $("loginStatus").className = "status error";

  return;
}

  $("adminLogin").classList.add("hidden");
  $("adminView").classList.remove("hidden");
  $("logoutBtn").classList.remove("hidden");
  $("adminEmail").textContent = session.user.email;

  await loadDocuments();
}

const {
  data: { session }
} = await sb.auth.getSession();

await showView(session);

sb.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => showView(session), 0);
});

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();

  $("loginStatus").textContent = "Entrando...";
  $("loginStatus").className = "status";

  const { error } = await sb.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value
  });

  if (error) {
    $("loginStatus").textContent =
      "Correo o contraseña incorrectos.";

    $("loginStatus").className =
      "status error";
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await sb.auth.signOut();
});

async function loadDocuments() {
  const { data, error } = await sb
    .from("documents")
    .select("*")
    .order("created_at", {
      ascending: false
    });

  if (error) {
    console.error("Error al cargar documentos:", error);
    return;
  }

  docs = data || [];

const clientFilter = $("adminClientFilter");

if (clientFilter) {
  const clients = [...new Set(
    docs
      .map(d => d.client_name)
      .filter(Boolean)
  )].sort();

  clientFilter.innerHTML =
    '<option value="">Selecciona un cliente</option>';

  clients.forEach(client => {
  const option = document.createElement("option");
  option.value = client;
  option.textContent = client;
  clientFilter.appendChild(option);
});

clientFilter.onchange = async e => {
  await loadAdminExpedient(
    e.target.value
  );
};

}

render();
}
async function loadAdminExpedient(clientName) {

  const summary =
    $("adminExpedientSummary");

  const checklist =
    $("adminRequirementsChecklist");

  if (!clientName) {

    summary.classList.add("hidden");
    checklist.classList.add("hidden");
    checklist.innerHTML = "";

    return;
  }

  const clientDocuments =
    docs.filter(
      d =>
        d.client_name === clientName
    );

  if (!clientDocuments.length) {

    summary.classList.add("hidden");
    checklist.classList.add("hidden");

    return;
  }

  const userId =
    clientDocuments[0].user_id;

  if (!userId) {

    console.error(
      "El cliente no tiene user_id asociado."
    );

    return;
  }

  const {
    data: profile,
    error: profileError
  } =
    await sb
      .from("profiles")
      .select(`
        person_type,
        operation_type,
        process_type,
        has_sector_registry,
        has_immex,
        has_prosec,
        is_certified_company
      `)
      .eq("id", userId)
      .single();

  if (profileError || !profile) {

    console.error(
      "No fue posible cargar el perfil del cliente:",
      profileError
    );

    return;
  }

  console.log(
    "PERFIL ADMIN CLIENTE:",
    profile
  );
  const {
  data: rules,
  error: rulesError
} =
  await sb
    .from("requirement_rules")
    .select(`
      requirement_code,
      requirement_level
    `)
    .eq("person_type", profile.person_type)
    .eq("operation_type", profile.operation_type)
    .eq("process_type", profile.process_type);

if (rulesError) {
  console.error(
    "No fue posible cargar las reglas:",
    rulesError
  );
  return;
}

const applicableRules =
  (rules || []).filter(rule => {

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

    return (
      rule.requirement_level !== "not_applicable"
    );
  });

const codes =
  applicableRules.map(
    rule => rule.requirement_code
  );

const {
  data: requirements,
  error: requirementsError
} =
  await sb
    .from("document_requirements")
    .select(`
      code,
      title,
      sort_order
    `)
    .in("code", codes)
    .order("sort_order", {
      ascending: true
    });

if (requirementsError) {
  console.error(
    "No fue posible cargar los requisitos:",
    requirementsError
  );
  return;
}

console.log(
  "REQUISITOS ADMIN:",
  requirements
);
 let approvedCount = 0;
let pendingCount = 0;
let rejectedCount = 0;
let missingCount = 0;

requirements.forEach(req => {
  const documentForRequirement =
    clientDocuments.find(
      d => d.requirement_code === req.code
    );

  if (!documentForRequirement) {
    missingCount++;
    return;
  }

  if (documentForRequirement.status === "approved") {
    approvedCount++;
  } else if (documentForRequirement.status === "rejected") {
    rejectedCount++;
  } else {
    pendingCount++;
  }
});

$("adminTotalRequirements").textContent =
  requirements.length;

$("adminApprovedRequirements").textContent =
  approvedCount;

$("adminPendingRequirements").textContent =
  pendingCount;

$("adminRejectedRequirements").textContent =
  rejectedCount;

$("adminMissingRequirements").textContent =
  missingCount;

summary.classList.remove("hidden");
  checklist.innerHTML = "";

requirements.forEach(req => {

  const documentForRequirement =
    clientDocuments.find(
      d => d.requirement_code === req.code
    );

  let state = "Falta cargar";
  let stateClass = "state-missing";

  if (documentForRequirement) {

    if (documentForRequirement.status === "approved") {
      state = "Aprobado";
      stateClass = "state-approved";

    } else if (documentForRequirement.status === "rejected") {
      state = "Rechazado";
      stateClass = "state-rejected";

    } else {
      state = "Pendiente de revisión";
      stateClass = "state-pending";
    }
  }

  const row =
    document.createElement("div");

  row.className = "requirement-row";

  row.innerHTML = `
    <div class="requirement-code">
      ${esc(req.code)}
    </div>

    <div>
      ${esc(req.title)}
    </div>

    <span class="requirement-state ${stateClass}">
      ${esc(state)}
    </span>
  `;

  checklist.appendChild(row);
});

checklist.classList.remove("hidden");
}
function render() {
  const q =
    $("search").value
      .trim()
      .toLowerCase();

  const filtered = docs.filter(d =>
    [
      d.client_name,
      d.reference,
      d.requirement_code,
      d.document_type,
      d.original_name,
      d.user_email,
      d.status,
      d.review_comments
    ]
      .join(" ")
      .toLowerCase()
      .includes(q)
  );

  $("rows").innerHTML = "";

  $("empty").style.display =
    filtered.length
      ? "none"
      : "block";

  filtered.forEach(d => {
    const tr =
      document.createElement("tr");

    const requirement =
      d.requirement_code ||
      d.document_type ||
      "—";

    const comments =
      d.review_comments
        ? esc(d.review_comments)
        : "—";

    const reviewInfo =
      d.reviewed_at
        ? `${comments}<br><small>${fmt(d.reviewed_at)}</small>`
        : comments;

    tr.innerHTML = `
      <td>${fmt(d.created_at)}</td>

      <td>${esc(d.client_name)}</td>

      <td>${esc(d.reference)}</td>

      <td>${esc(requirement)}</td>

      <td>${esc(d.original_name)}</td>

      <td>${esc(d.user_email)}</td>

      <td>
        <strong>${statusLabel(d.status)}</strong>
      </td>

      <td>
        ${reviewInfo}
      </td>

      <td>
        <a href="#" class="action-link open">
          Abrir
        </a>

        <button
          class="approve-btn"
          type="button">
          Aprobar
        </button>

        <button
          class="reject-btn"
          type="button">
          Rechazar
        </button>

        <button
          class="delete-btn"
          type="button">
          Eliminar
        </button>
      </td>
    `;

    tr
      .querySelector(".open")
      .addEventListener(
        "click",
        async e => {
          e.preventDefault();

          const {
            data: signed,
            error
          } =
            await sb.storage
              .from(BUCKET)
              .createSignedUrl(
                d.file_path,
                60
              );

          if (error) {
            alert(
              "No fue posible abrir el documento."
            );
            return;
          }

          window.open(
            signed.signedUrl,
            "_blank",
            "noopener"
          );
        }
      );

    tr
      .querySelector(".approve-btn")
      .addEventListener(
        "click",
        async () => {
          const ok = confirm(
            `¿Aprobar el documento ${d.original_name}?`
          );

          if (!ok) return;

          const {
            data: { user }
          } =
            await sb.auth.getUser();

          const {
            error
          } =
            await sb
              .from("documents")
              .update({
                status: "approved",
                review_comments: null,
                reviewed_by:
                  user?.id || null,
                reviewed_at:
                  new Date().toISOString()
              })
              .eq("id", d.id);

          if (error) {
            alert(
              "No fue posible aprobar el documento: " +
              error.message
            );
            return;
          }

          await loadDocuments();
        }
      );

    tr
      .querySelector(".reject-btn")
      .addEventListener(
        "click",
        async () => {
          const reason = prompt(
            "Indica el motivo del rechazo:"
          );

          if (reason === null) return;

          const cleanReason =
            reason.trim();

          if (!cleanReason) {
            alert(
              "Debes indicar el motivo del rechazo."
            );
            return;
          }

          const {
            data: { user }
          } =
            await sb.auth.getUser();

          const {
            error
          } =
            await sb
              .from("documents")
              .update({
                status: "rejected",
                review_comments:
                  cleanReason,
                reviewed_by:
                  user?.id || null,
                reviewed_at:
                  new Date().toISOString()
              })
              .eq("id", d.id);

          if (error) {
            alert(
              "No fue posible rechazar el documento: " +
              error.message
            );
            return;
          }

          await loadDocuments();
        }
      );

    tr
      .querySelector(".delete-btn")
      .addEventListener(
        "click",
        async () => {
          const ok = confirm(
            `¿Eliminar el documento ${d.original_name}?`
          );

          if (!ok) return;

          const {
            error: storageError
          } =
            await sb.storage
              .from(BUCKET)
              .remove([
                d.file_path
              ]);

          if (storageError) {
            alert(
              "No fue posible eliminar el archivo: " +
              storageError.message
            );
            return;
          }

          const {
            error: dbError
          } =
            await sb
              .from("documents")
              .delete()
              .eq("id", d.id);

          if (dbError) {
            alert(
              "No fue posible eliminar el registro: " +
              dbError.message
            );
            return;
          }

          await loadDocuments();
        }
      );

    $("rows").appendChild(tr);
  });
}

$("search").addEventListener(
  "input",
  render
);

$("adminClientFilter")?.addEventListener(
  "change",
  async e => {

    await loadAdminExpedient(
      e.target.value
    );
  }
);
