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

  render();
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

const header =
  document.createElement("div");

header.className = "admin-requirement-header";

header.innerHTML = `
  <div>Requisito</div>
  <div>Documento</div>
  <div>Estado</div>
  <div>Acción</div>
`;

checklist.appendChild(header);

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
      state = "Pendiente";
      stateClass = "state-pending";
    }
  }

  const row =
    document.createElement("div");

  row.className =
    "admin-requirement-row";

  const documentName =
    documentForRequirement
      ? esc(documentForRequirement.original_name)
      : "—";

 const action =
  documentForRequirement
    ? documentForRequirement.status === "approved"
      ? `
          <a
            href="#"
            class="action-link admin-requirement-open">
            Abrir
          </a>
        `
      : documentForRequirement.status === "rejected"
        ? `
            <a
              href="#"
              class="action-link admin-requirement-open">
              Abrir
            </a>

            <button
              type="button"
              class="approve-btn admin-requirement-approve">
              Aprobar
            </button>
          `
        : `
            <a
              href="#"
              class="action-link admin-requirement-open">
              Abrir
            </a>

            <button
              type="button"
              class="approve-btn admin-requirement-approve">
              Aprobar
            </button>

            <button
              type="button"
              class="reject-btn admin-requirement-reject">
              Rechazar
            </button>
          `
    : "—";

  row.innerHTML = `
    <div class="admin-requirement-name">
      <strong>${esc(req.code)}</strong>
      <span>${esc(req.title)}</span>
    </div>

    <div class="admin-requirement-document">
      ${documentName}
    </div>

    <div>
      <span class="requirement-state ${stateClass}">
        ${esc(state)}
      </span>
    </div>

    <div class="admin-requirement-actions">
      ${action}
    </div>
  `;

  const openButton =
    row.querySelector(
      ".admin-requirement-open"
    );

  if (
    openButton &&
    documentForRequirement
  ) {

    openButton.addEventListener(
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

        if (
          signedError ||
          !signed
        ) {

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
  }
const approveButton =
  row.querySelector(
    ".admin-requirement-approve"
  );

if (
  approveButton &&
  documentForRequirement
) {

  approveButton.addEventListener(
    "click",
    async () => {

      const ok = confirm(
        `¿Aprobar el documento ${documentForRequirement.original_name}?`
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
          .eq(
            "id",
            documentForRequirement.id
          );

      if (error) {
        alert(
          "No fue posible aprobar el documento: " +
          error.message
        );

        return;
      }

      await loadDocuments();

      await loadAdminExpedient(
        $("adminClientFilter").value
      );
    }
  );
}

const rejectButton =
  row.querySelector(
    ".admin-requirement-reject"
  );

if (
  rejectButton &&
  documentForRequirement
) {

  rejectButton.addEventListener(
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
          .eq(
            "id",
            documentForRequirement.id
          );

      if (error) {

        alert(
          "No fue posible rechazar el documento: " +
          error.message
        );

        return;
      }

      await loadDocuments();

      await loadAdminExpedient(
        $("adminClientFilter").value
      );
    }
  );
}
  checklist.appendChild(row);
});

checklist.classList.remove("hidden");
}
function render() {
  const q =
    $("search").value
      .trim()
      .toLowerCase();

  const selectedClient =
  $("adminClientFilter")?.value || "";

const filtered = docs.filter(d => {

  const matchesClient =
    !selectedClient ||
    d.client_name === selectedClient;

  const matchesSearch =
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
      .includes(q);

  return matchesClient && matchesSearch;
});

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
const adminTabs =
  document.querySelectorAll(".admin-tab");

const adminSections = [
  "documentsSection",
  "clientsSection",
  "requirementsSection",
  "formatsSection"
];

adminTabs.forEach(tab => {

  tab.addEventListener(
    "click",
    () => {

      const target =
        tab.dataset.section;

      adminTabs.forEach(item => {
        item.classList.remove("active");
      });

      tab.classList.add("active");
      
if (target === "clientsSection") {
  loadClientsAdmin();
}

if (target === "requirementsSection") {
  loadRequirementsAdmin();
}

adminSections.forEach(sectionId => {
        const section =
          document.getElementById(sectionId);

        if (!section) return;

        if (sectionId === target) {
          section.classList.remove("hidden");
        } else {
          section.classList.add("hidden");
        }

      });

    }
  );

});
async function loadClientsAdmin() {

  const clientsList =
    $("clientsList");

  if (!clientsList) return;

  clientsList.innerHTML =
    "Cargando clientes...";

  const {
    data: clients,
    error
  } =
    await sb
      .from("profiles")
      .select(`
        id,
        email,
        company,
        person_type,
        operation_type,
        process_type,
        has_sector_registry,
        has_immex,
        has_prosec,
        is_certified_company
      `)
      .eq("role", "client")
      .order("company", {
        ascending: true
      });

  if (error) {

    console.error(
      "No fue posible cargar los clientes:",
      error
    );

    clientsList.innerHTML =
      "No fue posible cargar los clientes.";

    return;
  }

  if (!clients?.length) {

    clientsList.innerHTML =
      "No hay clientes registrados.";

    return;
  }

  clientsList.innerHTML = "";

  clients.forEach(client => {

    const row =
      document.createElement("div");

    row.className =
      "client-admin-row";

    row.innerHTML = `
      <div>
        <strong>
          ${esc(client.company || "Sin empresa")}
        </strong>

        <div>
          ${esc(client.email || "—")}
        </div>
      </div>

      <button
        type="button"
        class="client-edit-btn">
        Editar
      </button>
    `;

    clientsList.appendChild(row);
    
const editButton =
  row.querySelector(".client-edit-btn");

if (editButton) {

  editButton.addEventListener(
    "click",
    () => {

     const formWrap = $("clientFormWrap");
const form = $("clientForm");

if (formWrap && form) {
  $("clientId").value = client.id || "";
  $("clientCompany").value = client.company || "";
  $("clientEmail").value = client.email || "";
  $("clientPersonType").value = client.person_type || "";
  $("clientOperationType").value = client.operation_type || "";
  $("clientProcessType").value = client.process_type || "";

  $("clientSectorRegistry").checked =
    client.has_sector_registry === true;

  $("clientImmex").checked =
    client.has_immex === true;

  $("clientProsec").checked =
    client.has_prosec === true;

  $("clientCertified").checked =
    client.is_certified_company === true;

  formWrap.classList.remove("hidden");

formWrap.scrollIntoView({
  behavior: "smooth",
  block: "start"
});
      }
    }
  );

}

});
}
$("clientForm")?.addEventListener(
  "submit",
  async e => {

    e.preventDefault();

    const clientId =
      $("clientId").value;

    if (!clientId) {
      alert("No se pudo identificar al cliente.");
      return;
    }

    const changes = {
      person_type:
        $("clientPersonType").value,

      operation_type:
        $("clientOperationType").value,

      process_type:
        $("clientProcessType").value,

      has_sector_registry:
        $("clientSectorRegistry").checked,

      has_immex:
        $("clientImmex").checked,

      has_prosec:
        $("clientProsec").checked,

      is_certified_company:
        $("clientCertified").checked
    };

    const {
      error
    } =
      await sb
        .from("profiles")
        .update(changes)
        .eq("id", clientId);

    if (error) {

      console.error(
        "No fue posible actualizar el cliente:",
        error
      );

      alert(
        "No fue posible guardar los cambios: " +
        error.message
      );

      return;
    }

    alert("Cliente actualizado correctamente.");

    $("clientFormWrap")
      ?.classList.add("hidden");

    await loadClientsAdmin();

  }
);
$("cancelClientBtn")?.addEventListener(
  "click",
  () => {

    $("clientFormWrap")
      ?.classList.add("hidden");

  }
);
async function loadRequirementsAdmin() {

  const requirementsList =
    $("requirementsAdminList");

  if (!requirementsList) return;

  requirementsList.innerHTML =
    "Cargando requisitos...";

  const {
    data: requirements,
    error
  } =
    await sb
      .from("document_requirements")
      .select(`
        id,
        code,
        title,
        category,
        applies_to,
        required,
        allow_not_applicable,
        template_file
      `)
      .order("code", {
        ascending: true
      });

  if (error) {

    console.error(
      "No fue posible cargar los requisitos:",
      error
    );

    requirementsList.innerHTML =
      "No fue posible cargar los requisitos.";

    return;
  }

  if (!requirements?.length) {

    requirementsList.innerHTML =
      "No hay requisitos registrados.";

    return;
  }

  requirementsList.innerHTML = "";

  requirements.forEach(req => {

    const row =
      document.createElement("div");

    row.className =
      "requirement-admin-row";

    const requiredLabel =
      req.required
        ? "Obligatorio"
        : "Condicional";

    row.innerHTML = `
      <div>
        <strong>${esc(req.code)}</strong>
      </div>

      <div>
        ${esc(req.title || "—")}
      </div>

      <div>
        ${esc(req.category || "—")}
      </div>

      <div>
        ${esc(requiredLabel)}
      </div>

      <button
        type="button"
        class="requirement-edit-btn">
        Editar
      </button>
    `;

    requirementsList.appendChild(row);

    const editButton =
  row.querySelector(".requirement-edit-btn");

if (editButton) {

  editButton.addEventListener(
    "click",
    () => {

      const formWrap =
        $("requirementFormWrap");

      const form =
        $("requirementForm");

      if (formWrap && form) {

        $("requirementId").value =
          req.id || "";

        $("requirementCode").value =
          req.code || "";

        $("requirementTitle").value =
          req.title || "";

        $("requirementCategory").value =
          req.category || "";

        $("requirementAppliesTo").value =
          req.applies_to || "all";

        $("requirementOperationType").value =
  req.operation_type || "all";

$("requirementProcessType").value =
  req.process_type || "all";

$("requirementProgram").value =
  req.program || "none";
        
        $("requirementRequired").checked =
          req.required === true;

        $("requirementAllowNA").checked =
          req.allow_not_applicable === true;

        formWrap.classList.remove("hidden");

formWrap.scrollIntoView({
  behavior: "smooth",
  block: "start"
});

        }
      }
    );
  }
});

}
// =====================================================
// GUARDAR CAMBIOS DE REQUISITOS
// =====================================================

$("requirementForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const requirementId = $("requirementId")?.value;

    if (!requirementId) {
        alert("No se encontró el requisito que se desea actualizar.");
        return;
    }

    const changes = {
        title: $("requirementTitle")?.value.trim(),
        category: $("requirementCategory")?.value.trim(),
        applies_to: $("requirementAppliesTo")?.value,
        required: $("requirementRequired")?.checked || false,
        allow_not_applicable: $("requirementAllowNA")?.checked || false
    };

    const { error } = await sb
        .from("document_requirements")
        .update(changes)
        .eq("id", requirementId);

    if (error) {
        console.error("Error al actualizar requisito:", error);
        alert(
            "No fue posible guardar los cambios: " +
            error.message
        );
        return;
    }

    alert("Requisito actualizado correctamente.");

    $("requirementFormWrap")?.classList.add("hidden");

    await loadRequirementsAdmin();
});
// ==============================
// FORMATOS / PLANTILLAS
// ==============================

async function loadTemplateRequirements() {
  const select = $("templateRequirement");
  if (!select) return;

  const { data, error } = await sb
    .from("document_requirements")
    .select("code,title")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Error al cargar requisitos para formatos:", error);
    return;
  }

  select.innerHTML =
    '<option value="">Selecciona un requisito</option>' +
    (data || [])
      .map(
        (r) =>
          `<option value="${esc(r.code)}">${esc(r.code)} - ${esc(
            r.title
          )}</option>`
      )
      .join("");
}

async function loadTemplatesAdmin() {
  const list = $("templatesList");
  if (!list) return;

  list.innerHTML = "Cargando formatos...";

  const { data, error } = await sb
    .from("requirement_templates")
    .select(
      "id,requirement_code,title,file_path,file_name,sort_order,active,created_at"
    )
    .order("requirement_code", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Error al cargar formatos:", error);
    list.innerHTML = "No fue posible cargar los formatos.";
    return;
  }

  if (!data?.length) {
    list.innerHTML = "<p>No hay formatos registrados.</p>";
    return;
  }

  list.innerHTML = data
    .map(
      (item) => `
        <div class="template-row" style="padding:14px 0;border-bottom:1px solid #ddd;">
          <div>
            <strong>${esc(item.requirement_code)} - ${esc(item.title)}</strong>
            <div style="margin-top:4px;font-size:14px;">
              ${esc(item.file_name || item.file_path)}
            </div>
          </div>

          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
            <button
              type="button"
              class="secondary"
              data-template-download="${item.id}">
              Descargar
            </button>

            <button
              type="button"
              class="secondary"
              data-template-delete="${item.id}">
              Eliminar
            </button>
          </div>
        </div>
      `
    )
    .join("");
}
$("templateForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const requirementCode = $("templateRequirement")?.value;
  const title = $("templateTitle")?.value.trim();
  const file = $("templateFile")?.files?.[0];

  if (!requirementCode || !title || !file) {
    alert("Completa todos los campos del formato.");
    return;
  }

  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const filePath = `${requirementCode}/${Date.now()}_${safeName}`;

  const { error: uploadError } = await sb.storage
    .from("templates")
    .upload(filePath, file, {
      upsert: false
    });

  if (uploadError) {
    console.error("Error al subir formato:", uploadError);
    alert("No fue posible subir el archivo: " + uploadError.message);
    return;
  }

  const { data: existingTemplates, error: countError } = await sb
    .from("requirement_templates")
    .select("id")
    .eq("requirement_code", requirementCode);

  if (countError) {
    console.error("Error al calcular orden del formato:", countError);
  }

  const nextOrder = (existingTemplates?.length || 0) + 1;

  const { error: insertError } = await sb
    .from("requirement_templates")
    .insert({
      requirement_code: requirementCode,
      title,
      file_path: filePath,
      file_name: file.name,
      sort_order: nextOrder,
      active: true
    });

  if (insertError) {
    console.error("Error al registrar formato:", insertError);

    await sb.storage
      .from("templates")
      .remove([filePath]);

    alert("No fue posible registrar el formato: " + insertError.message);
    return;
  }

  alert("Formato guardado correctamente.");

  $("templateForm")?.reset();

  await loadTemplatesAdmin();
});


$("templatesList")?.addEventListener("click", async (e) => {

  const downloadBtn = e.target.closest("[data-template-download]");
  const deleteBtn = e.target.closest("[data-template-delete]");

  if (downloadBtn) {

    const templateId = downloadBtn.dataset.templateDownload;

    const { data, error } = await sb
      .from("requirement_templates")
      .select("file_path,file_name")
      .eq("id", templateId)
      .single();

    if (error || !data) {
      console.error("Error al obtener formato:", error);
      alert("No fue posible localizar el formato.");
      return;
    }

    const { data: signedData, error: signedError } =
      await sb.storage
        .from("templates")
        .createSignedUrl(data.file_path, 60);

    if (signedError || !signedData?.signedUrl) {
      console.error("Error al generar descarga:", signedError);
      alert("No fue posible generar la descarga.");
      return;
    }

    const link = document.createElement("a");
    link.href = signedData.signedUrl;
    link.download = data.file_name || "formato";
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    link.remove();

    return;
  }


  if (deleteBtn) {

    const templateId = deleteBtn.dataset.templateDelete;

    if (!confirm("¿Deseas eliminar este formato?")) {
      return;
    }

    const { data, error } = await sb
      .from("requirement_templates")
      .select("file_path")
      .eq("id", templateId)
      .single();

    if (error || !data) {
      console.error("Error al localizar formato:", error);
      alert("No fue posible localizar el formato.");
      return;
    }

    const { error: storageError } =
      await sb.storage
        .from("templates")
        .remove([data.file_path]);

    if (storageError) {
      console.error("Error al eliminar archivo:", storageError);
      alert("No fue posible eliminar el archivo.");
      return;
    }

    const { error: deleteError } = await sb
      .from("requirement_templates")
      .delete()
      .eq("id", templateId);

    if (deleteError) {
      console.error("Error al eliminar registro:", deleteError);
      alert("El archivo se eliminó, pero no fue posible borrar el registro.");
      return;
    }

    await loadTemplatesAdmin();
  }
});
document
  .querySelector('[data-section="formatsSection"]')
  ?.addEventListener("click", async () => {
    await loadTemplateRequirements();
    await loadTemplatesAdmin();
  });
