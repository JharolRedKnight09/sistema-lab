// ============================================================================
// 1. SERVICIOS BASE & PERSISTENCIA
// ============================================================================

(function initEmailJS() {
  emailjs.init("ltRavHCUaZTBZkgYk");
})();

class Database {
  static load(key, defaultValue = null) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : defaultValue;
    } catch {
      return defaultValue;
    }
  }
}

async function loadCollectionWithLegacy(collectionName, storageKey, idField) {
  const marker = `lab_firestore_migrated_${collectionName}`;
  const remoteData = await window.firestore.loadAll(collectionName);
  if (localStorage.getItem(marker)) return remoteData;

  const legacyData = Database.load(storageKey, []);
  if (remoteData.length === 0 && legacyData.length > 0) {
    const migratedData = legacyData.map(item => ({ ...item }));
    let maxId = idField === "correlativo"
      ? migratedData.reduce((max, item) => Math.max(max, Number(item[idField]) || 0), 0)
      : 0;
    migratedData.forEach((item, index) => {
      if (item[idField] === undefined || item[idField] === null || item[idField] === "") {
        item[idField] = idField === "correlativo"
          ? ++maxId
          : `${Date.now()}_${index}_${Math.random().toString(36).slice(2)}`;
      }
    });
    await window.firestore.saveAll(collectionName, migratedData, idField);
    localStorage.setItem(marker, "true");
    return window.firestore.loadAll(collectionName);
  }

  localStorage.setItem(marker, "true");
  return remoteData;
}

async function loadDocumentWithLegacy(collectionName, documentId, storageKey) {
  const marker = `lab_firestore_migrated_${collectionName}`;
  const remoteData = await window.firestore.load(collectionName, documentId);
  if (localStorage.getItem(marker)) return remoteData;

  const legacyData = Database.load(storageKey);
  if (remoteData === null && legacyData !== null) {
    await window.firestore.save(collectionName, documentId, legacyData);
    localStorage.setItem(marker, "true");
    return legacyData;
  }

  localStorage.setItem(marker, "true");
  return remoteData;
}

async function loadUsersWithLegacy() {
  const marker = "lab_firestore_migrated_users";
  const remoteUsers = await window.firestore.getUsers();
  if (localStorage.getItem(marker)) {
    return Object.fromEntries(remoteUsers.map(({ id, ...user }) => [id, user]));
  }

  const legacyUsers = Database.load("lab_users", AuthManager.defaultUsers);
  if (remoteUsers.length === 0) {
    const users = Object.entries(legacyUsers).map(([id, user]) => ({ id, ...user }));
    await window.firestore.saveAll("users", users, "id");
    localStorage.setItem(marker, "true");
    return legacyUsers;
  }

  localStorage.setItem(marker, "true");
  return Object.fromEntries(remoteUsers.map(({ id, ...user }) => [id, user]));
}

function showSyncError(error) {
  console.error("Error sincronizando con Firestore:", error);
  return Swal.fire("Error de sincronización", error.message || "No se pudieron guardar los cambios.", "error");
}

let solicitudes = [];

// ============================================================================
// 2. MODELO DE NEGOCIO
// ============================================================================

class LaboratoryManager {
  constructor() {
    this.doctores = Database.load(" doctores\, []);
    this.examenes = Database.load(" examenes\, []);
    this.ordenes = [];
    this.seguros = [];
    this.caja = { cierres: [], papeleraCierres: [], mesActual: null };

  }

  async init() {
    this.doctores = await loadCollectionWithLegacy("doctores", "doctores", "dpi");
    this.examenes = await loadCollectionWithLegacy("examenes", "examenes", "codigo");
    this.ordenes = await loadCollectionWithLegacy("ordenes", "ordenes", "correlativo");
    this.seguros = await loadCollectionWithLegacy("seguros", "seguros", "codigo");
    const cajaData = await loadDocumentWithLegacy("caja", "config", "caja");
    if (cajaData) this.caja = cajaData;

    await this.inicializarMachotes();
    await this.limpiarExamenesDuplicados();
    await this.inicializarCaja();
    await this.repararCorrelativos();
    const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
    await window.firestore.initializeOrderCounters(this.ordenes, hoy);
  }

  async inicializarMachotes() {
    if (this.examenes.length === 0 || !this.examenes.some(e => e.codigo === "HEMA")) {
      if (!this.examenes.some(e => e.codigo === "HEMA")) {
        const machoteM = [
          { parametro: "ERITROSEDIMENTACION", referencia: "0 - 20 mm/hora" },
          { parametro: "RECUENTO DE LEUCOCITOS", referencia: "3,500 - 9,500 cel/mm3" },
          { parametro: "RECUENTO DE ERITROCITOS", referencia: "4,300,000 - 5,800,000 cel/mm3" },
          { parametro: "HEMOGLOBINA (Hb)", referencia: "13 - 17.5 g/dl" },
          { parametro: "HEMATOCRITO (Ht)", referencia: "40 - 50 %" },
          { parametro: "VOL. CORPUSCULAR MEDIO", referencia: "82 - 100 fL" },
          { parametro: "HEMOGLOBINA CORPUSCULAR MEDIA", referencia: "27 - 34 pg" },
          { parametro: "CONCENTRACION HB. CORP. MEDIA", referencia: "31.6 - 35.4 g/dL" },
          { parametro: "SEGMENTADOS", referencia: "40 - 75 %" },
          { parametro: "LINFOCITOS", referencia: "20 - 50 %" },
          { parametro: "MONOCITOS", referencia: "3 - 10 %" },
          { parametro: "EOSINÓFILOS", referencia: "0.4 - 8 %" },
          { parametro: "BASÓFILOS", referencia: "0 - 1 %" },
          { parametro: "CAYADOS", referencia: "0 - 3 %" },
          { parametro: "RECUENTO DE PLAQUETAS", referencia: "100,000 - 500,000 cel/mm3" }
        ];
        const machoteF = [
          { parametro: "ERITROSEDIMENTACION", referencia: "0 - 20 mm/hora" },
          { parametro: "RECUENTO DE LEUCOCITOS", referencia: "3,500 - 9,500 cel/mm3" },
          { parametro: "RECUENTO DE ERITROCITOS", referencia: "3,800,000 - 5,100,000 cel/mm3" },
          { parametro: "HEMOGLOBINA (Hb)", referencia: "11.5 - 15 g/dl" },
          { parametro: "HEMATOCRITO (Ht)", referencia: "35 - 45 %" },
          { parametro: "VOL. CORPUSCULAR MEDIO", referencia: "82 - 100 fL" },
          { parametro: "HEMOGLOBINA CORPUSCULAR MEDIA", referencia: "27 - 34 pg" },
          { parametro: "CONCENTRACION HB. CORP. MEDIA", referencia: "31.6 - 35.4 g/dL" },
          { parametro: "SEGMENTADOS", referencia: "40 - 75 %" },
          { parametro: "LINFOCITOS", referencia: "20 - 50 %" },
          { parametro: "MONOCITOS", referencia: "3 - 10 %" },
          { parametro: "EOSINÓFILOS", referencia: "0.4 - 8 %" },
          { parametro: "BASÓFILOS", referencia: "0 - 1 %" },
          { parametro: "CAYADOS", referencia: "0 - 3 %" },
          { parametro: "RECUENTO DE PLAQUETAS", referencia: "100,000 - 500,000 cel/mm3" }
        ];
        const machoteN = [
          { parametro: "ERITROSEDIMENTACION", referencia: "0 - 20 mm/hora" },
          { parametro: "RECUENTO DE LEUCOCITOS", referencia: "3,500 - 12,000 cel/mm3" },
          { parametro: "RECUENTO DE ERITROCITOS", referencia: "3,500,000 - 5,200,000 cel/mm3" },
          { parametro: "HEMOGLOBINA (Hb)", referencia: "12 - 16 g/dl" },
          { parametro: "HEMATOCRITO (Ht)", referencia: "35 - 49 %" },
          { parametro: "VOL. CORPUSCULAR MEDIO", referencia: "82 - 100 fL" },
          { parametro: "HEMOGLOBINA CORPUSCULAR MEDIA", referencia: "27 - 34 pg" },
          { parametro: "CONCENTRACION HB. CORP. MEDIA", referencia: "31 - 37 g/dL" },
          { parametro: "SEGMENTADOS", referencia: "40 - 75 %" },
          { parametro: "LINFOCITOS", referencia: "20 - 50 %" },
          { parametro: "MONOCITOS", referencia: "3 - 10 %" },
          { parametro: "EOSINÓFILOS", referencia: "0.4 - 8 %" },
          { parametro: "BASÓFILOS", referencia: "0 - 1 %" },
          { parametro: "CAYADOS", referencia: "0 - 3 %" },
          { parametro: "RECUENTO DE PLAQUETAS", referencia: "100,000 - 500,000 cel/mm3" }
        ];

        const examen = {
          codigo: "HEMA",
          nombre: "HEMATOLOGÍA COMPLETA",
          precio: 100,
          descripcion: "Hemograma completo con fórmula diferencial.",
          parametros: [],
          machotes: { M: machoteM, F: machoteF, N: machoteN }
        };
        await window.firestore.saveExamen(examen.codigo, examen);
        this.examenes.push(examen);
      }
    }
  }

  async inicializarCaja() {
    const ahora = new Date();
    const mesActual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;

    let changed = false;
    if (!Array.isArray(this.caja.cierres)) {
      const cierres = [];
      if (Array.isArray(this.caja.movimientos)) {
        this.caja.movimientos.forEach((m, i) => {
          if (m.fecha && typeof m.total === 'number') {
            cierres.push({
              id: 'mig_' + i + '_' + Date.now(),
              fecha: m.fecha,
              totalCaja: m.total,
              numPacientes: 0,
              examenesRealizados: 0,
              tarjetaCant: 0,
              tarjetaSaldo: 0,
              efectivoCant: 0,
              efectivoSaldo: m.total,
              cerradoPor: 'Migrado',
              horaCierre: '—',
              timestamp: Date.now()
            });
          }
        });
      }
      this.caja = { mesActual, cierres, papeleraCierres: [] };
      changed = true;
    } else {
      if (!Array.isArray(this.caja.papeleraCierres)) {
        this.caja.papeleraCierres = [];
        changed = true;
      }
      if (this.caja.mesActual !== mesActual) {
        this.caja.mesActual = mesActual;
        changed = true;
      }
    }
    if (changed) await window.firestore.saveCaja(this.caja);
  }

  async limpiarExamenesDuplicados() {
    const codigos = new Set();
    const examenesUnicos = [];
    for (const examen of this.examenes) {
      if (codigos.has(examen.codigo)) {
        if (examen.id && String(examen.id) !== String(examen.codigo)) {
          await window.firestore.deleteExamen(examen.id);
        }
      } else {
        codigos.add(examen.codigo);
        examenesUnicos.push(examen);
      }
    }
    this.examenes = examenesUnicos;
  }

  async repararCorrelativos() {
    let maxCorrelativo = 0;
    this.ordenes.forEach(o => {
      if (o.correlativo && Number(o.correlativo) > maxCorrelativo) {
        maxCorrelativo = Number(o.correlativo);
      }
    });
    for (const orden of this.ordenes) {
      if (!orden.correlativo) {
        maxCorrelativo++;
        const idAnterior = orden.id;
        const ordenActualizada = { ...orden, correlativo: maxCorrelativo };
        if (idAnterior && String(idAnterior) !== String(maxCorrelativo)) {
          await window.firestore.move("ordenes", idAnterior, maxCorrelativo, ordenActualizada);
        } else {
          await window.firestore.saveOrden(maxCorrelativo, ordenActualizada);
        }
        Object.assign(orden, ordenActualizada, { id: String(maxCorrelativo) });
      }
    }
  }

  // ===== Exámenes =====
  async agregarExamen(codigo, nombre, precio, descripcion = "") {
    if (this.examenes.some(ex => ex.codigo === codigo)) throw new Error("El código ya existe.");
    const examen = { codigo, nombre, precio: Number(precio), descripcion, parametros: [], machotes: null };
    await window.firestore.saveExamen(codigo, examen);
    const index = this.examenes.findIndex(ex => ex.codigo === codigo);
    if (index === -1) this.examenes.push(examen);
    else this.examenes[index] = examen;
  }

  async actualizarExamen(index, nuevosDatos) {
    const ex = this.examenes[index];
    const datosActualizados = { ...ex, ...nuevosDatos };
    if (datosActualizados.codigo !== ex.codigo) {
      await window.firestore.move("examenes", ex.codigo, datosActualizados.codigo, datosActualizados);
    } else {
      await window.firestore.saveExamen(ex.codigo, datosActualizados);
    }
    this.examenes = this.examenes.filter(item =>
      item.codigo !== ex.codigo && item.codigo !== datosActualizados.codigo
    );
    this.examenes.push(datosActualizados);
  }

  async eliminarExamen(index) {
    const ex = this.examenes[index];
    await window.firestore.deleteExamen(ex.codigo);
    this.examenes = this.examenes.filter(item => item.codigo !== ex.codigo);
  }

  // ===== Doctores =====
  async agregarDoctor(dpi, nombre, especialidad) {
    if (this.doctores.some(d => d.dpi === dpi)) throw new Error("Ya existe un doctor con ese DPI.");
    this.doctores.push({ dpi, nombre, especialidad, activo: true });
    Database.save("doctores", this.doctores);
  }

  async actualizarDoctor(index, nuevosDatos) {
    const doc = this.doctores[index];
    const datosActualizados = { ...doc, ...nuevosDatos };
    if (datosActualizados.dpi !== doc.dpi) {
      await window.firestore.move("doctores", doc.dpi, datosActualizados.dpi, datosActualizados);
    } else {
      await window.firestore.saveDoctor(doc.dpi, datosActualizados);
    }
    this.doctores = this.doctores.filter(item =>
      item.dpi !== doc.dpi && item.dpi !== datosActualizados.dpi
    );
    this.doctores.push(datosActualizados);
  }

  async eliminarDoctor(index) {
    const doc = this.doctores[index];
    await window.firestore.deleteDoctor(doc.dpi);
    this.doctores = this.doctores.filter(item => item.dpi !== doc.dpi);
  }

  // ===== Seguros =====
  async agregarSeguro(codigo, nombre, descuento) {
    if (this.seguros.some(s => s.codigo === codigo)) throw new Error("El código de seguro ya existe.");
    const seguro = { codigo, nombre, descuento: Number(descuento) };
    await window.firestore.saveSeguro(codigo, seguro);
    const index = this.seguros.findIndex(s => s.codigo === codigo);
    if (index === -1) this.seguros.push(seguro);
    else this.seguros[index] = seguro;
  }

  async actualizarSeguro(index, nuevosDatos) {
    const s = this.seguros[index];
    const datosActualizados = { ...s, ...nuevosDatos };
    if (datosActualizados.codigo !== s.codigo) {
      await window.firestore.move("seguros", s.codigo, datosActualizados.codigo, datosActualizados);
    } else {
      await window.firestore.saveSeguro(s.codigo, datosActualizados);
    }
    this.seguros = this.seguros.filter(item =>
      item.codigo !== s.codigo && item.codigo !== datosActualizados.codigo
    );
    this.seguros.push(datosActualizados);
  }

  async eliminarSeguro(index) {
    const s = this.seguros[index];
    await window.firestore.deleteSeguro(s.codigo);
    this.seguros = this.seguros.filter(item => item.codigo !== s.codigo);
  }

  // ===== Órdenes =====
  async crearOrden({ paciente, doctor, examenesSeleccionados, total, descuentoQ, totalOriginal, edad, tipoSeguro, clasificacion, metodoPago, recargoPct, recibido, cambio }) {
    const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
    
    const maxCorrelativo = this.ordenes.length > 0 ? Math.max(...this.ordenes.map(o => Number(o.correlativo) || 0)) : 0;
    const ordenesHoy = this.ordenes.filter(o => o.fecha === hoy);
    const maxNumero = ordenesHoy.length > 0 ? Math.max(...ordenesHoy.map(o => Number(o.numero) || 0)) : 0;

    const nuevaOrden = {
      edad, fecha: hoy, paciente, doctor,
      tipoSeguro: tipoSeguro || "Ninguno",
      clasificacion: clasificacion || "M",
      genero: clasificacion,
      metodoPago: metodoPago || "Efectivo",
      recargoPct: recargoPct || 0,
      recibido: recibido || 0,
      cambio: cambio || 0,
      examenes: JSON.parse(JSON.stringify(examenesSeleccionados)), 
      total, totalOriginal, descuentoQ, resultados: {},
      creadoPor: AuthManager.currentUser?.nombre || "desconocido"
    };

    const orden = await window.firestore.createOrder(nuevaOrden, maxCorrelativo, maxNumero);
    const index = this.ordenes.findIndex(o => Number(o.correlativo) === Number(orden.correlativo));
    if (index === -1) this.ordenes.push(orden);
    else this.ordenes[index] = orden;
    return orden;
  }

  async actualizarDatosPaciente(correlativo, nuevosDatos) {
    const orden = this.buscarOrden(correlativo);
    if (orden) {
      const actualizada = {
        ...orden,
        paciente: nuevosDatos.paciente || orden.paciente,
        edad: nuevosDatos.edad || orden.edad
      };
      await window.firestore.saveOrden(actualizada.correlativo, actualizada);
      Object.assign(orden, actualizada);
    }
  }

  async guardarResultados(correlativo, resultados) {
    const orden = this.buscarOrden(correlativo);
    if (orden) {
      const actualizada = { ...orden, resultados };
      await window.firestore.saveOrden(actualizada.correlativo, actualizada);
      Object.assign(orden, actualizada);
    }
  }

  async eliminarOrden(correlativo) {
    await window.firestore.deleteOrden(correlativo);
    this.ordenes = this.ordenes.filter(o => Number(o.correlativo) !== Number(correlativo));
  }

  buscarOrden(correlativo) {
    return this.ordenes.find(o => Number(o.correlativo) === Number(correlativo));
  }

  // ===== Caja =====
  async cerrarCaja(fecha, cerradoPor) {
    if (this.caja.cierres.some(c => c.fecha === fecha)) {
      throw new Error("Ya existe un cierre para esta fecha.");
    }

    const ordenesHoy = this.ordenes.filter(o => o.fecha === fecha);
    const pacientesSet = new Set();

    let totalCaja = 0;
    let examenesRealizados = 0;
    let tarjetaCant = 0;
    let tarjetaSaldo = 0;
    let efectivoCant = 0;
    let efectivoSaldo = 0;

    ordenesHoy.forEach(o => {
      const monto = Number(o.total || 0);
      totalCaja += monto;
      examenesRealizados += (o.examenes ? o.examenes.length : 0);
      if (o.paciente) pacientesSet.add(o.paciente.trim().toLowerCase());

      if (o.metodoPago === 'Tarjeta') {
        tarjetaCant++;
        tarjetaSaldo += monto;
      } else {
        efectivoCant++;
        efectivoSaldo += monto;
      }
    });

    const cierre = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
      fecha,
      totalCaja,
      numPacientes: pacientesSet.size,
      examenesRealizados,
      tarjetaCant,
      tarjetaSaldo,
      efectivoCant,
      efectivoSaldo,
      cerradoPor: cerradoPor || "desconocido",
      horaCierre: new Date().toLocaleTimeString("sv-SE"),
      timestamp: Date.now()
    };

    const cajaActualizada = { ...this.caja, cierres: [...this.caja.cierres, cierre] };
    await window.firestore.saveCaja(cajaActualizada);
    this.caja = cajaActualizada;
    return cierre;
  }

  async eliminarCierreSoft(id) {
    const index = this.caja.cierres.findIndex(c => c.id === id);
    if (index !== -1) {
      const cierre = { ...this.caja.cierres[index] };
      cierre.eliminadoEn = new Date().toISOString();
      const cajaActualizada = {
        ...this.caja,
        cierres: this.caja.cierres.filter(c => c.id !== id),
        papeleraCierres: [...this.caja.papeleraCierres, cierre]
      };
      await window.firestore.saveCaja(cajaActualizada);
      this.caja = cajaActualizada;
    }
  }

  async restaurarCierre(id) {
    const index = this.caja.papeleraCierres.findIndex(c => c.id === id);
    if (index !== -1) {
      const cierre = { ...this.caja.papeleraCierres[index] };
      delete cierre.eliminadoEn;
      const cajaActualizada = {
        ...this.caja,
        cierres: [...this.caja.cierres, cierre],
        papeleraCierres: this.caja.papeleraCierres.filter(c => c.id !== id)
      };
      await window.firestore.saveCaja(cajaActualizada);
      this.caja = cajaActualizada;
    }
  }

  async eliminarCierreDefinitivo(id) {
    const cajaActualizada = {
      ...this.caja,
      papeleraCierres: this.caja.papeleraCierres.filter(c => c.id !== id)
    };
    await window.firestore.saveCaja(cajaActualizada);
    this.caja = cajaActualizada;
  }

  obtenerCierres(mes) {
    const lista = !mes
      ? this.caja.cierres.slice()
      : this.caja.cierres.filter(c => c.fecha.startsWith(mes));
    return lista.sort((a, b) => b.fecha.localeCompare(a.fecha));
  }

  obtenerTotalDia(fecha) {
    return this.ordenes
      .filter(o => o.fecha === fecha)
      .reduce((s, o) => s + Number(o.total || 0), 0);
  }

  obtenerTotalMes(mes) {
    return this.ordenes
      .filter(o => (o.fecha || '').startsWith(mes))
      .reduce((s, o) => s + Number(o.total || 0), 0);
  }

  obtenerTotalAcumulado() {
    return this.ordenes.reduce((s, o) => s + Number(o.total || 0), 0);
  }

  // ===== Reportes =====
  calcularComisiones(porcentaje = 10) {
    const comisiones = {};
    this.doctores.forEach(doctor => {
      const ordenesDoctor = this.ordenes.filter(o => o.doctor === doctor.nombre);
      const totalDoctor = ordenesDoctor.reduce((sum, o) => sum + Number(o.total || 0), 0);
      comisiones[doctor.nombre] = {
        pacientes: ordenesDoctor.length,
        total: totalDoctor,
        comision: ((totalDoctor * porcentaje) / 100).toFixed(2)
      };
    });
    return comisiones;
  }
}

// ============================================================================
// 3. NOTIFICACIONES
// ============================================================================

class NotificationService {
  static actualizarBadges(currentUser) {
    if (!currentUser) return;

    const badge = document.getElementById("notifBadge");
    const infoCard = document.getElementById("notifInfoCard");
    const noNotif = document.getElementById("noNotifMsg");
    const mensaje = document.getElementById("notifMensaje");
    if (!badge || !infoCard || !noNotif || !mensaje) return;

    if (currentUser.rol === 'doctor') {
      const noLeidas = solicitudes.filter(s => s.doctor === currentUser.nombre && s.estado === 'enviada' && !s.leidoPorDoctor);
      this._renderState(noLeidas.length, `Tienes <strong>${noLeidas.length}</strong> resultado(s) recibido(s) de laboratorio.`, badge, infoCard, noNotif, mensaje);
    } else {
      const pendientes = solicitudes.filter(s => s.estado === "pendiente");
      const ultima = pendientes[pendientes.length - 1];
      const meText = ultima ? `El doctor <strong>${ultima.doctor}</strong> ha solicitado los resultados de la paciente <strong>${ultima.paciente}</strong>.` : '';
      this._renderState(pendientes.length, meText, badge, infoCard, noNotif, mensaje);
    }
  }

  static _renderState(count, textHtml, badge, infoCard, noNotif, mensaje) {
    if (count > 0) {
      badge.style.display = "block";
      badge.textContent = count;
      mensaje.innerHTML = textHtml;
      infoCard.classList.remove("hidden");
      noNotif.style.display = "none";
    } else {
      badge.style.display = "none";
      infoCard.classList.add("hidden");
      noNotif.style.display = "block";
    }
  }

  static mostrarModal(currentUser) {
    if (currentUser.rol === 'doctor') {
      const noLeidas = solicitudes.filter(s => s.doctor === currentUser.nombre && s.estado === 'enviada' && !s.leidoPorDoctor);
      if (noLeidas.length === 0) return Swal.fire("Sin notificaciones", "No tienes resultados nuevos.", "info");

      let html = `<div style="text-align:left; max-height:300px; overflow-y:auto;">`;
      noLeidas.forEach(p => {
        html += `<div style="padding:10px; border-bottom:1px solid #eee;">
          <p style="margin:0; font-size:14px;">Has recibido los resultados de <strong>${p.paciente}</strong></p>
          <small style="color:#64748b;">${p.fecha}</small>
        </div>`;
      });
      html += `</div>`;

      return Swal.fire({
        title: 'Resultados Recibidos', html, icon: 'info',
        confirmButtonText: 'Ir a Mis Solicitudes', confirmButtonColor: '#1a4a7a', zIndex: 99999
      }).then(res => {
        if (res.isConfirmed) AuthManager.mostrarVistaUsuario('userMisSolicitudes');
      });
    }

    const pendientes = solicitudes.filter(s => s.estado === "pendiente");
    if (pendientes.length === 0) return Swal.fire("Sin notificaciones", "No hay solicitudes pendientes.", "info");

    let html = `<div style="text-align:left; max-height:300px; overflow-y:auto;">`;
    pendientes.forEach(p => {
      html += `<div style="padding:10px; border-bottom:1px solid #eee;">
        <p style="margin:0; font-size:14px;">El doctor <strong>${p.doctor}</strong> ha solicitado los resultados de la paciente <strong>${p.paciente}</strong></p>
        <small style="color:#64748b;">${p.fecha}</small>
      </div>`;
    });
    html += `</div>`;

    Swal.fire({
      title: 'Solicitudes Pendientes', html, icon: 'info',
      confirmButtonText: 'Ir a Colaboraciones', confirmButtonColor: '#1a4a7a', zIndex: 99999
    }).then(res => {
      if (res.isConfirmed) AuthManager.mostrarVistaUsuario('userColaboraciones');
    });
  }
}

// ============================================================================
// 4. SERVICIO PDF
// ============================================================================

class PDFService {
  static async seleccionarYLeerPDF() {
    return new Promise((resolve, reject) => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'application/pdf';
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);

      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        document.body.removeChild(fileInput);
        if (!file) return resolve(null);
        if (file.type !== 'application/pdf') {
          Swal.fire("Error", "El archivo seleccionado debe ser un PDF.", "error");
          return resolve(null);
        }
        Swal.fire({ title: 'Procesando archivo...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });
        const reader = new FileReader();
        reader.onload = (evt) => resolve(evt.target.result);
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
      });

      fileInput.click();
    });
  }

  static generarEmbedHTML(base64Data, height = "480px") {
    return `
      <div style="margin-bottom: 15px;">
        <iframe src="${base64Data}" width="100%" height="${height}" style="border: 1px solid #cbd5e1; border-radius: 6px;"></iframe>
      </div>
    `;
  }
}

// ============================================================================
// 5. UI MANAGER
// ============================================================================

class UIManager {
  constructor(manager) {
    this.manager = manager;
    this.examenesSeleccionados = [];
    this.totalActual = 0;
    this.descuentoQ = 0;
    this.ordenActualParaResultados = null;
    this.ordenActualModal = null;
    this._chartDoctores = null;
    this._chartUsuarios = null;
    
    this.metodoPago = 'Efectivo';
    this.recargoPct = 0;
    
    this.machoteEditandoIndex = null;
    
    window.ui = this;
  }

  getEncabezadoHTML() {
    return `
      <div class="print-header">
        <div style="width: 80px;"></div>
        <div class="print-header-titles">
          <h1>NUEVA ESPERANZA</h1>
          <h2>Laboratorio Clínico Microbiológico</h2>
        </div>
        <img src="logo.jpeg" alt="Logo" class="print-logo" style="border-radius:50%;" onerror="this.style.display='none'">
      </div>
    `;
  }

  actualizarNotificaciones() {
    NotificationService.actualizarBadges(AuthManager.currentUser);
  }

  mostrarNotificaciones() {
    NotificationService.mostrarModal(AuthManager.currentUser);
  }

  // ===== PERFIL / SEGURIDAD =====
  renderPerfil() {
    const user = AuthManager.currentUser;
    if (!user) return;
    const userData = AuthManager.users[user.username];
    
    document.getElementById('perfilNombre').textContent = user.nombre;
    document.getElementById('perfilUsername').textContent = user.username;
    document.getElementById('perfilRol').textContent = user.rol.toUpperCase();
    
    const fotoContainer = document.getElementById('perfilFotoContainer');
    const btnEliminar = document.getElementById('btnEliminarFoto');
    
    if (userData && userData.foto) {
      fotoContainer.innerHTML = `<img src="${userData.foto}" style="width: 100%; height: 100%; object-fit: cover;">`;
      if (btnEliminar) btnEliminar.style.display = 'block';
    } else {
      fotoContainer.innerHTML = `<i class="fa-solid fa-user" style="font-size: 50px; color: #94a3b8;"></i>`;
      if (btnEliminar) btnEliminar.style.display = 'none';
    }
  }

  subirFotoPerfil(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return Swal.fire("Error", "Seleccione una imagen válida.", "error");
    
    Swal.fire({ title: 'Procesando imagen...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result;
      const user = AuthManager.currentUser;
      if (user && AuthManager.users[user.username]) {
        try {
          const updatedUser = { ...AuthManager.users[user.username], foto: base64 };
          await window.firestore.saveUser(user.username, updatedUser);
          AuthManager.users[user.username] = updatedUser;
          this.renderPerfil();
          this.actualizarNavbarFoto();
          Swal.close();
          Swal.fire("Éxito", "Foto de perfil actualizada.", "success");
        } catch (error) {
          showSyncError(error);
        }
      }
    };
    reader.readAsDataURL(file);
  }

  verFotoPerfil() {
    const user = AuthManager.currentUser;
    const userData = AuthManager.users[user.username];
    
    if (!userData || !userData.foto) {
      return Swal.fire('Info', 'No has subido una foto de perfil aún.', 'info');
    }

    Swal.fire({
      title: 'Foto de Perfil',
      imageUrl: userData.foto,
      imageWidth: 350,
      imageAlt: 'Foto de Perfil',
      showConfirmButton: false,
      showCloseButton: true,
      background: 'rgba(0,0,0,0)',
      backdrop: 'rgba(0,0,0,0.8)'
    });
  }

  eliminarFotoPerfil() {
    Swal.fire({
      title: '¿Eliminar foto de perfil?',
      text: "Tu foto será removida de tu cuenta.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      confirmButtonColor: '#e74c3c',
      cancelButtonText: 'Cancelar'
    }).then(async (res) => {
      if (res.isConfirmed) {
        const user = AuthManager.currentUser;
        if (user && AuthManager.users[user.username]) {
          const updatedUser = { ...AuthManager.users[user.username] };
          delete updatedUser.foto;
          try {
            await window.firestore.saveUser(user.username, updatedUser);
            AuthManager.users[user.username] = updatedUser;
            this.renderPerfil();
            this.actualizarNavbarFoto();
            Swal.fire("Eliminada", "La foto ha sido eliminada correctamente.", "success");
          } catch (error) {
            showSyncError(error);
          }
        }
      }
    });
  }

  abrirModalContrasena() {
    Swal.fire({
      title: '<span style="color: var(--primary-blue); font-weight: bold; font-size: 24px;">Actualizar Contraseña</span>',
      html: `
        <div style="display: flex; flex-direction: column; gap: 16px; text-align: left; padding: 10px 5px;">
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 13px; font-weight: 600; color: #475569;">Contraseña Actual</label>
            <input id="swal-pass-act" type="password" placeholder="Ingrese su contraseña actual" style="width: 100%; padding: 12px 14px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; outline: none; transition: border 0.3s; box-sizing: border-box;">
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 13px; font-weight: 600; color: #475569;">Nueva Contraseña</label>
            <input id="swal-pass-new" type="password" placeholder="Ingrese su nueva contraseña" style="width: 100%; padding: 12px 14px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; outline: none; transition: border 0.3s; box-sizing: border-box;">
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 13px; font-weight: 600; color: #475569;">Confirmar Nueva Contraseña</label>
            <input id="swal-pass-conf" type="password" placeholder="Confirme su nueva contraseña" style="width: 100%; padding: 12px 14px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; outline: none; transition: border 0.3s; box-sizing: border-box;">
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '<i class="fa-solid fa-check"></i> Guardar Cambios',
      confirmButtonColor: '#1E8449',
      cancelButtonText: 'Cancelar',
      cancelButtonColor: '#64748b',
      width: '450px',
      focusConfirm: false,
      preConfirm: () => {
        const actual = document.getElementById('swal-pass-act').value;
        const nueva = document.getElementById('swal-pass-new').value;
        const confirmar = document.getElementById('swal-pass-conf').value;
        
        if (!actual || !nueva || !confirmar) {
          Swal.showValidationMessage('Complete todos los campos');
          return false;
        }
        if (nueva !== confirmar) {
          Swal.showValidationMessage('Las contraseñas nuevas no coinciden');
          return false;
        }
        if (nueva.length < 6) {
          Swal.showValidationMessage('La nueva contraseña debe tener al menos 6 caracteres');
          return false;
        }
        
        const user = AuthManager.currentUser;
        if (AuthManager.users[user.username].pass !== actual) {
          Swal.showValidationMessage('La contraseña actual es incorrecta');
          return false;
        }
        
        return { nueva };
      }
    }).then(async (result) => {
      if (result.isConfirmed) {
        const user = AuthManager.currentUser;
        const updatedUser = { ...AuthManager.users[user.username], pass: result.value.nueva };
        try {
          await window.firestore.saveUser(user.username, updatedUser);
          AuthManager.users[user.username] = updatedUser;
          Swal.fire({
            title: '¡Actualizada!',
            text: 'Tu contraseña ha sido cambiada correctamente.',
            icon: 'success',
            confirmButtonColor: '#1E8449'
          });
        } catch (error) {
          showSyncError(error);
        }
      }
    });
  }

  actualizarNavbarFoto() {
    const user = AuthManager.currentUser;
    if (!user) return;
    const wrapper = document.getElementById('navUserAvatar');
    if (!wrapper) return;
    
    const userData = AuthManager.users[user.username];
    if (userData && userData.foto) {
      wrapper.innerHTML = `<img src="${userData.foto}" style="width: 100%; height: 100%; object-fit: cover;">`;
    } else {
      wrapper.innerHTML = `<i class="fa-solid fa-circle-user" style="font-size: 35px; color: #94a3b8;"></i>`;
    }
  }

  // ===== PERMISOS =====
  abrirModalPermisos(username) {
    const user = AuthManager.users[username];
    if (!user) return;

    const currentPerms = user.permisos || AuthManager.getDefaultPermissions(user.rol);

    const checkboxes = [
      { id: 'permInicio', label: 'Inicio', key: 'menuInicio' },
      { id: 'permResultados', label: 'Resultados', key: 'menuResultados' },
      { id: 'permNuevaOrden', label: 'Nueva Orden', key: 'menuNuevaOrden' },
      { id: 'permExamenes', label: 'Exámenes', key: 'menuExamenes' },
      { id: 'permReportes', label: 'Reportes', key: 'menuReportes' },
      { id: 'permBitacora', label: 'Bitácora de Transacciones', key: 'menuBitacora' },
      { id: 'permSolicitar', label: 'Solicitar Resultados (Doctor)', key: 'menuSolicitar' },
      { id: 'permMisSolicitudes', label: 'Mis Solicitudes (Doctor)', key: 'menuMisSolicitudes' },
      { id: 'permDoctores', label: 'Afiliar Doctores', key: 'dropDoctores' },
      { id: 'permSeguros', label: 'Seguros', key: 'dropSeguros' },
      { id: 'permColaboraciones', label: 'Realizar Colaboración', key: 'dropColaboraciones' }
    ];

    let html = `
      <div style="max-height: 400px; overflow-y: auto; padding-right: 5px;">
        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 14px;">
          <thead style="position: sticky; top: 0; background: white; z-index: 10;">
            <tr style="border-bottom: 2px solid #e2e8f0;">
              <th style="padding: 10px; color: #1e293b;">Sección</th>
              <th style="padding: 10px; text-align: center; color: #1e293b; width: 130px;">Marcar / Permiso</th>
            </tr>
          </thead>
          <tbody>
    `;

    checkboxes.forEach(cb => {
      const checked = currentPerms[cb.key] ? 'checked' : '';
      html += `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 12px 10px; vertical-align: middle;">
            <label for="${cb.id}" style="font-weight: 500; cursor: pointer; display: block; margin: 0; color: #334155;">${cb.label}</label>
          </td>
          <td style="padding: 12px 10px; text-align: center; vertical-align: middle;">
            <input type="checkbox" id="${cb.id}" ${checked} style="transform: scale(1.4); cursor: pointer; margin: 0;">
          </td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </div>
    `;

    Swal.fire({
      title: `Permisos de ${user.nombre}`,
      html: html,
      width: '600px',
      showCancelButton: true,
      confirmButtonText: 'Guardar Permisos',
      confirmButtonColor: '#1E8449',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const newPerms = {};
        checkboxes.forEach(cb => {
          newPerms[cb.key] = document.getElementById(cb.id).checked;
        });
        return newPerms;
      }
    }).then(async res => {
      if (res.isConfirmed) {
        const updatedUser = { ...AuthManager.users[username], permisos: res.value };
        try {
          await window.firestore.saveUser(username, updatedUser);
          AuthManager.users[username] = updatedUser;
          if (AuthManager.currentUser && AuthManager.currentUser.username === username) {
            AuthManager.currentUser.permisos = res.value;
            AuthManager.aplicarPermisos(AuthManager.currentUser);
          }

          Swal.fire("Guardado", "Permisos actualizados correctamente.", "success");
          AdminController.renderPermisosUsuarios();
        } catch (error) {
          showSyncError(error);
        }
      }
    });
  }

  // ===== SOLICITUDES =====
  async crearSolicitud() {
    const paciente = document.getElementById("solicitudPaciente").value.trim();
    if (!paciente) return Swal.fire("Error", "Ingrese el nombre del paciente", "error");

    const solicitud = {
      id: Date.now().toString() + Math.random().toString(36).substring(2),
      doctor: AuthManager.currentUser.nombre,
      paciente,
      fecha: new Date().toLocaleDateString(),
      estado: "pendiente",
      leidoPorDoctor: false
    };

    try {
      await window.firestore.saveSolicitud(solicitud.id, solicitud);
      if (!solicitudes.some(existing => String(existing.id) === String(solicitud.id))) {
        solicitudes.push(solicitud);
      }
    } catch (error) {
      return showSyncError(error);
    }
    document.getElementById("solicitudPaciente").value = "";
    this.actualizarNotificaciones();
    this.renderMisSolicitudes();
    Swal.fire("Éxito", "Solicitud enviada a recepción/laboratorio", "success");
  }

  async renderColaboraciones() {
    document.getElementById('vistaDoctoresColaboraciones')?.classList.remove('hidden');
    document.getElementById('vistaDetalleColaboraciones')?.classList.add('hidden');

    const tbody = document.querySelector("#tablaColaboracionesDoctores tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const agrupadas = solicitudes.reduce((acc, s) => {
      acc[s.doctor] = acc[s.doctor] || [];
      acc[s.doctor].push(s);
      return acc;
    }, {});

    const doctores = Object.keys(agrupadas);
    if (doctores.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:20px;">No hay solicitudes de ningún doctor.</td></tr>`;
      return;
    }

    doctores.forEach(doc => {
      const pendientes = agrupadas[doc].filter(s => s.estado === 'pendiente').length;
      const total = agrupadas[doc].length;
      const docEscaped = doc.replace(/'/g, "\\'");
      tbody.innerHTML += `
        <tr>
          <td><strong>${doc}</strong></td>
          <td>${pendientes > 0 ? `<span style="color:#f59e0b; font-weight:bold;">${pendientes} pendientes</span>` : 'Ninguna pendiente'} (${total} en total)</td>
          <td><button class="btn-primary" onclick="ui.verSolicitudesDoctor('${docEscaped}')">Ver Solicitudes</button></td>
        </tr>
      `;
    });
  }

  async verSolicitudesDoctor(doctor) {
    document.getElementById('vistaDoctoresColaboraciones')?.classList.add('hidden');
    document.getElementById('vistaDetalleColaboraciones')?.classList.remove('hidden');
    document.getElementById('nombreDoctorColab').textContent = doctor;

    const tbody = document.querySelector("#tablaSolicitudesDoctor tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const sols = solicitudes.filter(s => s.doctor === doctor).reverse();
    if (sols.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px;">No hay solicitudes de este doctor.</td></tr>`;
      return;
    }

    for (const s of sols) {
      if (!s.id) {
        s.id = Date.now().toString() + Math.random().toString(36).substring(2);
        try {
          await window.firestore.saveSolicitud(s.id, s);
        } catch (error) {
          showSyncError(error);
          return;
        }
      }
      const doctorEscaped = doctor.replace(/'/g, "\\'");
      const estadoHTML = s.estado === 'pendiente'
        ? `<span style="color:#f59e0b; font-weight:bold;">En espera</span>`
        : `<span style="background:#dcfce7; color:#166534; padding:3px 8px; border-radius:4px; font-size:12px; font-weight:600;">Enviado</span>`;
      const btnHtml = s.estado === 'pendiente'
        ? `<button class="btn-primary" style="background:#3498db; padding:6px 12px; font-size:12px; margin-right:5px;" onclick="ui.abrirModalCompartirPDF('${s.id}', '${doctorEscaped}')"><i class="fa-solid fa-upload"></i> Compartir Resultados</button>
           <button class="btn-danger" onclick="ui.eliminarSolicitud('${s.id}', '${doctorEscaped}')">Cancelar</button>`
        : `<button class="btn-primary" style="background:#E67E22; padding:6px 12px; font-size:12px; margin-right:5px;" onclick="ui.verEnvioLaboratorio('${s.id}')"><i class="fa-solid fa-eye"></i> Ver Envío</button>
           <button class="btn-danger" onclick="ui.eliminarEnvio('${s.id}', '${doctorEscaped}')" title="Regresar a 'En espera'">Volver a Enviar</button>`;
      tbody.innerHTML += `<tr><td>${s.paciente}</td><td>${s.fecha}</td><td>${estadoHTML}</td><td>${btnHtml}</td></tr>`;
    }
  }

  volverListaDoctores() { this.renderColaboraciones(); }

  async abrirModalCompartirPDF(solicitudId, doctorSolicitante) {
    const sol = solicitudes.find(s => String(s.id) === String(solicitudId));
    if (!sol) return;

    const result = await Swal.fire({
      title: 'Compartir Resultados',
      text: 'Seleccione el archivo PDF de los resultados desde su equipo.',
      showCancelButton: true,
      confirmButtonText: '<i class="fa-solid fa-upload"></i> Seleccionar Archivo',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#3498db', cancelButtonColor: 'red'
    });

    if (result.isConfirmed) {
      try {
        const base64Data = await PDFService.seleccionarYLeerPDF();
        if (base64Data) {
          const actualizada = {
            ...sol,
            estado: "enviada",
            resultado: `Enviado a ${doctorSolicitante}`,
            leidoPorDoctor: false,
            pdfBase64: base64Data
          };
          await window.firestore.saveSolicitud(sol.id, actualizada);
          Object.assign(sol, actualizada);
          this.actualizarNotificaciones();
          this.verSolicitudesDoctor(doctorSolicitante);
          Swal.close();
          Swal.fire({ title: '¡Enviado!', text: `El PDF ha sido enviado al ${doctorSolicitante}.`, icon: 'success', confirmButtonColor: '#1E8449' });
        }
      } catch (err) {
        showSyncError(err);
      }
    }
  }

  verEnvioLaboratorio(solicitudId) {
    const sol = solicitudes.find(s => String(s.id) === String(solicitudId));
    if (!sol || !sol.pdfBase64) return Swal.fire("Error", "No se encontró el documento adjunto.", "error");

    Swal.fire({
      title: `Envío para Dr(a). ${sol.doctor}`,
      html: `
        <p style="margin-bottom: 10px; color: #475569;">Paciente: <strong>${sol.paciente}</strong> (${sol.fecha})</p>
        ${PDFService.generarEmbedHTML(sol.pdfBase64, "380px")}
        <a href="${sol.pdfBase64}" download="Resultados_${sol.paciente}.pdf" class="btn-primary" style="background:#1E8449; padding: 10px 20px; text-decoration: none; display: inline-block; border-radius: 6px; color: white;">
          <i class="fa-solid fa-download"></i> Descargar PDF
        </a>
      `,
      width: '600px', showCloseButton: true, showConfirmButton: false, zIndex: 99999
    });
  }

  async verResultadosDoctor(solicitudId) {
    const sol = solicitudes.find(s => String(s.id) === String(solicitudId));
    if (!sol) return;
    const actualizada = { ...sol, leidoPorDoctor: true };
    try {
      await window.firestore.saveSolicitud(sol.id, actualizada);
      Object.assign(sol, actualizada);
    } catch (error) {
      return showSyncError(error);
    }
    this.actualizarNotificaciones();

    const pdfHtml = sol.pdfBase64
      ? `<div style="margin-top: 10px; padding: 15px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;">
          <h3 style="color: #166534; margin-bottom: 10px;"><i class="fa-solid fa-file-pdf"></i> Resultados de: ${sol.paciente}</h3>
          <p style="margin-bottom: 15px; color: #15803d;">Vista previa del documento oficial enviado por el laboratorio:</p>
          ${PDFService.generarEmbedHTML(sol.pdfBase64, "480px")}
          <a href="${sol.pdfBase64}" download="Resultados_${sol.paciente}.pdf" class="btn-primary" style="background:#1E8449; padding: 10px 20px; text-decoration: none; display: inline-block; border-radius: 6px; color: white;">
            <i class="fa-solid fa-download"></i> Descargar PDF
          </a>
        </div>`
      : `<p style="text-align:center; padding:20px; color:#64748b;">No hay archivo PDF adjunto en este envío.</p>`;

    const contenedor = document.getElementById("contenidoTablaResultadosDoctor");
    if (contenedor) contenedor.innerHTML = `<div class="sat-card-body">${pdfHtml}</div>`;
    document.getElementById('vistaTablaMisSolicitudes')?.classList.add('hidden');
    document.getElementById('vistaTablaResultadosDoctor')?.classList.remove('hidden');
  }

  renderMisSolicitudes() {
    document.getElementById('vistaTablaResultadosDoctor')?.classList.add('hidden');
    document.getElementById('vistaTablaMisSolicitudes')?.classList.remove('hidden');

    const tbody = document.querySelector("#tablaMisSolicitudes tbody");
    if (!tbody || !AuthManager.currentUser) return;
    tbody.innerHTML = "";

    const misSolicitudes = solicitudes.filter(s => s.doctor === AuthManager.currentUser.nombre).reverse();
    if (misSolicitudes.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">No has realizado solicitudes.</td></tr>`;
      return;
    }

    misSolicitudes.forEach(s => {
      const estadoHTML = s.estado === 'pendiente'
        ? `<span style="background:#fee2e2; color:#991b1b; padding:3px 8px; border-radius:4px; font-size:12px; font-weight:600;">EN ESPERA</span>`
        : `<span style="background:#dcfce7; color:#166534; padding:3px 8px; border-radius:4px; font-size:12px; font-weight:600;">RECIBIDO</span>`;
      const btnAccion = s.estado === 'pendiente'
        ? `<span style="color:#64748b; font-size:12px;">Pendiente de envío...</span>`
        : `<button class="btn-primary" style="background:#3498db; padding:6px 12px; font-size:12px;" onclick="ui.verResultadosDoctor('${s.id}')">Ver / Descargar PDF</button>`;
      tbody.innerHTML += `<tr><td>${s.paciente}</td><td>${s.fecha}</td><td>${estadoHTML}</td><td>${btnAccion}</td></tr>`;
    });
  }

  eliminarSolicitud(id, doctor) {
    Swal.fire({
      title: '¿Cancelar solicitud?', text: 'Esta acción eliminará la solicitud por completo.', icon: 'warning',
      showCancelButton: true, confirmButtonText: 'Sí, eliminar', confirmButtonColor: '#e74c3c'
    }).then(async r => {
      if (r.isConfirmed) {
        try {
          await window.firestore.deleteSolicitud(id);
          solicitudes = solicitudes.filter(s => String(s.id) !== String(id));
          this.verSolicitudesDoctor(doctor);
          this.actualizarNotificaciones();
          Swal.fire("Eliminado", "Solicitud eliminada", "success");
        } catch (error) {
          showSyncError(error);
        }
      }
    });
  }

  async eliminarEnvio(id, doctor) {
    Swal.fire({
      title: '¿Volver a enviar?', text: 'El documento se marcará como "En espera" para volver a enviarlo.', icon: 'warning',
      showCancelButton: true, confirmButtonText: 'Sí, volver a enviar', confirmButtonColor: '#e74c3c'
    }).then(async r => {
      if (r.isConfirmed) {
        const sol = solicitudes.find(s => String(s.id) === String(id));
        if (sol) {
          const actualizada = { estado: "pendiente", resultado: "", numeroOrden: null, leidoPorDoctor: false, pdfBase64: null };
          try {
            await window.firestore.saveSolicitud(id, { ...sol, ...actualizada });
            Object.assign(sol, actualizada);
            this.verSolicitudesDoctor(doctor);
            this.actualizarNotificaciones();
            Swal.fire("Listo", "Puede volver a compartir el documento.", "success");
          } catch (error) {
            showSyncError(error);
          }
        }
      }
    });
  }

  // ===== NUEVA ORDEN =====
  irAPaso2() {
    const nombre = document.getElementById("nombrePaciente").value.trim();
    const fechaNac = document.getElementById("fechaNacimiento").value;
    const edadManual = document.getElementById("edadPaciente").value.trim();
    const doctor = document.getElementById("doctorSelect").value;

    if (!nombre) return Swal.fire("Atención", "Ingrese el nombre del paciente", "warning");
    if (!fechaNac && !edadManual) return Swal.fire("Atención", "Ingrese la fecha de nacimiento o la edad", "warning");
    if (!doctor) return Swal.fire("Atención", "Seleccione un doctor", "warning");

    document.getElementById("ordenPaso1").classList.add("hidden");
    document.getElementById("ordenPaso2").classList.remove("hidden");
    this.renderSelectSeguros();
    this.renderChecklistExamenes();
  }

  irAPaso1() {
    document.getElementById("ordenPaso2").classList.add("hidden");
    document.getElementById("ordenPaso1").classList.remove("hidden");
  }

  calcularEdadAuto() {
    const fecha = document.getElementById("fechaNacimiento").value;
    const inputEdad = document.getElementById("edadPaciente");
    if (!fecha) { inputEdad.value = ""; return; }

    const hoy = new Date();
    const nacimiento = new Date(fecha);
    let años = hoy.getFullYear() - nacimiento.getFullYear();
    const m = hoy.getMonth() - nacimiento.getMonth();
    if (m < 0 || (m === 0 && hoy.getDate() < nacimiento.getDate())) años--;

    if (años >= 1) {
      inputEdad.value = `${años} año${años !== 1 ? 's' : ''}`;
    } else {
      let meses = (hoy.getFullYear() - nacimiento.getFullYear()) * 12 + (hoy.getMonth() - nacimiento.getMonth());
      if (hoy.getDate() < nacimiento.getDate()) meses--;
      inputEdad.value = `${Math.max(0, meses)} mes${meses !== 1 ? 'es' : ''}`;
    }
  }

  mostrarInfoExamen(index) {
    const ex = this.manager.examenes[index];
    Swal.fire({ title: ex.nombre, text: ex.descripcion || "No hay indicaciones específicas registradas.", icon: 'info', confirmButtonColor: '#0b1f3d', zIndex: 99999 });
  }

  filtrarChecklist() {
    const filtro = (document.getElementById('buscarExamen')?.value || '').toLowerCase();
    document.querySelectorAll('#listaExamenes tbody tr').forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(filtro) ? '' : 'none';
    });
  }

  renderSelectSeguros() {
    const select = document.getElementById("tipoSeguro");
    if (!select) return;
    select.innerHTML = `<option value="Ninguno">Ninguno</option>`;
    this.manager.seguros.forEach(s => {
      select.innerHTML += `<option value="${s.nombre}" data-descuento="${s.descuento}">${s.nombre} (${s.descuento}%)</option>`;
    });
  }

  aplicarSeguro() {
    const select = document.getElementById("tipoSeguro");
    const option = select.options[select.selectedIndex];
    const inputDescuento = document.getElementById("descuentoOrden");

    if (select.value === "Ninguno") {
      inputDescuento.value = "";
      this.actualizarDescuento();
      return;
    }

    const descuentoPct = parseFloat(option.getAttribute("data-descuento")) || 0;
    const montoDescuento = this.totalActual * (descuentoPct / 100);
    inputDescuento.value = montoDescuento.toFixed(2);
    this.actualizarDescuento();
  }

  actualizarDescuento() {
    let descuento = parseFloat(document.getElementById("descuentoOrden").value) || 0;
    descuento = Math.max(0, Math.min(descuento, this.totalActual));
    this.descuentoQ = descuento;
    document.getElementById("descuentoVisual").textContent = (this.totalActual > 0 ? (descuento / this.totalActual) * 100 : 0).toFixed(1) + "%";
    this.calcularTotalFinal();
  }

  calcularTotalFinal() {
    document.getElementById("totalOrden").textContent = this.totalActual.toFixed(2);
    document.getElementById("totalFinal").textContent = (this.totalActual - this.descuentoQ).toFixed(2);
  }

  renderChecklistExamenes() {
    const contenedor = document.getElementById("listaExamenes");
    contenedor.innerHTML = "";
    this.examenesSeleccionados = [];
    this.totalActual = 0;
    document.getElementById("descuentoOrden").value = "";
    document.getElementById("descuentoVisual").textContent = "0%";
    this.calcularTotalFinal();

    if (this.manager.examenes.length === 0) {
      contenedor.innerHTML = `<p style="color:#64748b; padding:15px;">No hay exámenes registrados. Cree uno primero.</p>`;
      return;
    }

    const examenesOrdenados = [...this.manager.examenes].sort((a, b) => a.nombre.localeCompare(b.nombre));

    let html = `<table class="checklist-table">
      <thead>
        <tr>
          <th style="width: 40px; text-align: center;"></th>
          <th>Cód. Examen</th>
          <th>Nombre examen</th>
          <th>Precio</th>
          <th style="text-align: center; width: 120px;">Especificaciones</th>
        </tr>
      </thead>
      <tbody>`;

    examenesOrdenados.forEach(e => {
      const originalIndex = this.manager.examenes.findIndex(x => x.codigo === e.codigo);
      html += `
        <tr data-codigo="${e.codigo}" data-precio="${e.precio}" data-index="${originalIndex}">
          <td style="text-align: center;"><input type="checkbox" class="chk-examen" data-codigo="${e.codigo}"></td>
          <td>${e.codigo}</td>
          <td>${e.nombre}</td>
          <td>Q${Number(e.precio).toFixed(2)}</td>
          <td style="text-align: center;">
            <div class="info-btn" onclick="event.stopPropagation(); ui.mostrarInfoExamen(${originalIndex})">!</div>
          </td>
        </tr>
      `;
    });
    html += `</tbody></table>`;
    contenedor.innerHTML = html;

    contenedor.querySelectorAll('tbody tr').forEach(tr => {
      tr.addEventListener('click', (event) => {
        if (event.target.tagName === 'INPUT') return;
        const chk = tr.querySelector('.chk-examen');
        chk.checked = !chk.checked;
        chk.dispatchEvent(new Event('change'));
      });

      const chk = tr.querySelector('.chk-examen');
      chk.addEventListener('change', () => {
        const codigo = chk.dataset.codigo;
        const precio = Number(tr.dataset.precio);
        const index = Number(tr.dataset.index);
        const examenObj = this.manager.examenes[index];

        if (chk.checked) {
          this.examenesSeleccionados.push(examenObj);
          this.totalActual += precio;
        } else {
          this.examenesSeleccionados = this.examenesSeleccionados.filter(x => x.codigo !== codigo);
          this.totalActual -= precio;
        }
        this.calcularTotalFinal();
        if (document.getElementById("tipoSeguro").value !== "Ninguno") {
          this.aplicarSeguro();
        }
      });
    });
  }

  // ===== COBRO / PAGO =====
  abrirModalCobro() {
    const nombre = document.getElementById("nombrePaciente").value.trim();
    const doctor = document.getElementById("doctorSelect").value;
    if (!nombre || !doctor) return Swal.fire("Atención", "Complete los datos del paciente y doctor.", "warning");
    if (this.examenesSeleccionados.length === 0) return Swal.fire("Atención", "Seleccione al menos un examen.", "warning");

    this.metodoPago = 'Efectivo';
    this.recargoPct = 0;
    
    document.getElementById("recargoPago").value = "";
    document.getElementById("pagoRecibido").value = "";
    
    this.seleccionarMetodoPago('Efectivo');
    document.getElementById("modalCobro").classList.remove("hidden");
  }

  seleccionarMetodoPago(metodo) {
    this.metodoPago = metodo;
    
    const btnTarjeta = document.getElementById("btn-pago-tarjeta");
    const btnEfectivo = document.getElementById("btn-pago-efectivo");
    const recargoContainer = document.getElementById("pagoRecargoContainer");
    const recargoVisualContainer = document.getElementById("recargoVisualContainer");
    const inputRecibido = document.getElementById("pagoRecibido");

    if (metodo === 'Tarjeta') {
      btnTarjeta.style.border = "3px solid var(--primary-blue)";
      btnEfectivo.style.border = "3px solid transparent";
      recargoContainer.classList.remove("hidden");
      recargoVisualContainer.classList.remove("hidden");
      inputRecibido.disabled = true;
      this.actualizarCalculoPago();
    } else {
      btnEfectivo.style.border = "3px solid var(--primary-blue)";
      btnTarjeta.style.border = "3px solid transparent";
      recargoContainer.classList.add("hidden");
      recargoVisualContainer.classList.add("hidden");
      inputRecibido.disabled = false;
      inputRecibido.value = "";
      this.recargoPct = 0;
      this.actualizarCalculoPago();
    }
  }

  actualizarCalculoPago() {
    const totalBase = this.totalActual - this.descuentoQ;
    let totalFinal = totalBase;
    
    if (this.metodoPago === 'Tarjeta') {
      let recargo = parseFloat(document.getElementById("recargoPago").value) || 0;
      recargo = Math.max(0, recargo);
      this.recargoPct = recargo;
      
      const montoRecargo = (totalBase * recargo) / 100;
      totalFinal = totalBase + montoRecargo;
      
      document.getElementById("cobroRecargoVisual").textContent = `Q${montoRecargo.toFixed(2)}`;
      
      const inputRecibido = document.getElementById("pagoRecibido");
      inputRecibido.value = totalFinal.toFixed(2);
      document.getElementById("pagoCambio").value = "0.00";
    } else {
      const inputRecibido = document.getElementById("pagoRecibido");
      const recibido = parseFloat(inputRecibido.value) || 0;
      const cambio = recibido - totalFinal;
      document.getElementById("pagoCambio").value = cambio > 0 ? cambio.toFixed(2) : "0.00";
    }

    document.getElementById("cobroTotalBase").textContent = `Q${totalBase.toFixed(2)}`;
    document.getElementById("cobroTotalFinal").textContent = `Q${totalFinal.toFixed(2)}`;
  }

  // ===== ÓRDENES =====
  filtrarPorFecha() {
    const fecha = document.getElementById("filtroFecha").value;
    const tbody = document.querySelector("#tablaResultados tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const filtradas = fecha ? this.manager.ordenes.filter(o => o.fecha === fecha) : this.manager.ordenes;

    filtradas.forEach(o => {
      const tieneRes = Object.keys(o.resultados || {}).length > 0;
      const numFormateado = String(o.numero).padStart(7, '0');
      const corrFormateado = String(o.correlativo || o.numero).padStart(7, '0');
      const total = Number(o.total || 0).toFixed(2);
      const btnVer = tieneRes
        ? `<button onclick="ui.verResultados(${o.correlativo})" class="btn-primary" style="background:#1E8449; padding:6px 12px; font-size:12px;"><i class="fa-solid fa-file-pdf"></i> Ver/Imprimir</button>`
        : `<button disabled style="opacity:0.5;cursor:not-allowed; padding:6px 12px; font-size:12px; border-radius:4px; background:#94a3b8; color:white;">Ver</button>`;

      tbody.innerHTML += `
        <tr>
          <td>#${numFormateado}</td><td>#${corrFormateado}</td><td>${formatearFecha(o.fecha)}</td><td>${o.paciente}</td><td>${o.doctor}</td><td>Q${total}</td>
          <td class="td-acciones1"><button onclick="ui.verDetalles(${o.correlativo})">Detalles</button></td>
          <td class="td-acciones2"><button onclick="ui.abrirModalResultados(${o.correlativo})">${tieneRes ? 'Editar' : 'Añadir'}</button></td>
          <td class="td-acciones3">${btnVer}</td>
          <td class="td-acciones4"><button onclick="ui.eliminarOrden(${o.correlativo})">Eliminar</button></td>
        </tr>`;
    });
  }

  verDetalles(correlativo) {
    const orden = this.manager.buscarOrden(correlativo);
    if (!orden) return;
    this.ordenActualModal = orden;
    
    document.getElementById("btnEditarDatosModal").style.display = 'inline-block';

    const numFormateado = String(orden.numero).padStart(7, '0');
    const corrFormateado = String(orden.correlativo || orden.numero).padStart(7, '0');

    let html = `
      <div class="print-preview-container">
        ${this.getEncabezadoHTML()}
        <table class="print-patient-table">
          <tr><th>Paciente:</th><td>${orden.paciente}</td><th>Correlativo:</th><td>#${corrFormateado}</td></tr>
          <tr><th>Edad:</th><td>${orden.edad || "N/A"}</td><th>Fecha:</th><td>${formatearFecha(orden.fecha)}</td></tr>
          <tr><th>Doctor Ref.:</th><td colspan="3">${orden.doctor}</td></tr>
        </table>
        <div style="text-align: right; font-weight: bold; font-size: 16px; margin-bottom: 10px;">
          Orden #${numFormateado}
        </div>
        <p style="font-weight:bold; margin-bottom:10px;">Exámenes Solicitados:</p>
        <table class="print-exams-table">
          <thead><tr><th>Examen</th><th style="text-align:right;">Precio</th></tr></thead>
          <tbody>`;
    orden.examenes.forEach(e => { html += `<tr><td>${e.nombre}</td><td style="text-align:right;">Q${e.precio}</td></tr>`; });
    html += `</tbody></table>`;

    const totalOrig = Number(orden.totalOriginal || 0).toFixed(2);
    const desc = Number(orden.descuentoQ || 0).toFixed(2);
    const totalF = Number(orden.total || 0).toFixed(2);

    html += `
        <div style="text-align:right; font-size:14px; margin-bottom:10px;">
          ${orden.descuentoQ > 0 ? `<p><strong>Subtotal:</strong> Q${totalOrig}</p><p><strong>Descuento:</strong> -Q${desc}</p>` : ''}
          ${orden.metodoPago === 'Tarjeta' && orden.recargoPct > 0 ? `<p><strong>Recargo (${orden.recargoPct}%):</strong> Aplicado</p>` : ''}
        </div>
        <div class="print-total">TOTAL FINAL: Q${totalF}</div>
        <div style="margin-top:10px; font-size:12px; color:#555;">
          <p><strong>Método de pago:</strong> ${orden.metodoPago || 'Efectivo'}</p>
          <p><strong>Recibido:</strong> Q${Number(orden.recibido || 0).toFixed(2)} | <strong>Cambio:</strong> Q${Number(orden.cambio || 0).toFixed(2)}</p>
        </div>
      </div>`;
    document.getElementById("contenidoOrden").innerHTML = html;
    document.getElementById("modalDetalles").classList.remove("hidden");
  }

  verResultados(correlativo) {
    const orden = this.manager.buscarOrden(correlativo);
    if (!orden || Object.keys(orden.resultados || {}).length === 0) return;
    this.ordenActualModal = orden;
    
    document.getElementById("btnEditarDatosModal").style.display = 'none';

    const numFormateado = String(orden.numero).padStart(7, '0');
    const corrFormateado = String(orden.correlativo || orden.numero).padStart(7, '0');
    const clasif = orden.clasificacion || orden.genero || 'M';
    const clasifStr = clasif === 'M' ? 'Hombre' : clasif === 'F' ? 'Mujer' : 'Niño';

    const headerHTML = `
      <table class="print-patient-table">
        <tr><th>Paciente:</th><td>${orden.paciente}</td><th>Correlativo:</th><td>#${corrFormateado}</td></tr>
        <tr><th>Edad:</th><td>${orden.edad || "N/A"}</td><th>Fecha:</th><td>${formatearFecha(orden.fecha)}</td></tr>
        <tr><th>Referido por:</th><td colspan="3">${orden.doctor}</td></tr>
      </table>
      <div style="text-align: right; font-weight: bold; font-size: 16px; margin-bottom: 10px;">
        Orden #${numFormateado}
      </div>
    `;

    let htmlPage1 = "";
    let htmlPage2 = "";

    let hematologias = [];
    let otrosMachotes = [];
    let examenesSimples = [];

    orden.examenes.forEach(ex => {
      const liveExam = this.manager.examenes.find(e => e.codigo === ex.codigo);
      const machote = (liveExam && liveExam.machotes) ? liveExam.machotes[clasif] : (ex.machotes ? ex.machotes[clasif] : null);
      const tieneMachote = machote && machote.length > 0;

      if (ex.codigo === "HEMA" || (ex.nombre && ex.nombre.toUpperCase().includes("HEMATOLOG"))) {
         hematologias.push({ ex, machote, tieneMachote });
      } else if (tieneMachote) {
         otrosMachotes.push({ ex, machote });
      } else {
         examenesSimples.push(ex);
      }
    });

    // PAGE 1: Hematology
    if (hematologias.length > 0) {
       let tablaHema = "";
       hematologias.forEach(({ ex, machote, tieneMachote }) => {
          tablaHema += `<h3 style="text-align:center; margin: 15px 0 10px 0; font-size: 16px;">${ex.nombre}</h3>`;
          if (tieneMachote) {
             tablaHema += `
               <table class="print-exams-table" style="page-break-inside: avoid;">
                 <thead>
                   <tr>
                     <th>Análisis / Determinación</th>
                     <th style="text-align:center; width: 120px;">Resultado</th>
                     <th>Referencia</th>
                   </tr>
                 </thead>
                 <tbody>`;
             machote.forEach((param, pIdx) => {
                const val = (orden.resultados[ex.codigo] && orden.resultados[ex.codigo][pIdx]) ? orden.resultados[ex.codigo][pIdx] : "";
                tablaHema += `<tr>
                  <td>${param.parametro}</td>
                  <td style="text-align:center; font-weight:bold;">${val}</td>
                  <td>${param.referencia}</td>
                </tr>`;
             });
             tablaHema += `</tbody></table>`;
          } else {
             const r = (orden.resultados[ex.codigo] && orden.resultados[ex.codigo].texto) ? orden.resultados[ex.codigo].texto : "PENDIENTE";
             tablaHema += `
               <table class="print-exams-table" style="page-break-inside: avoid;">
                 <thead><tr><th>Análisis / Determinación</th><th style="text-align:center; width: 120px;">Resultado</th><th>Referencia</th></tr></thead>
                 <tbody><tr><td>${ex.nombre}</td><td style="text-align:center; font-weight:bold;">${r}</td><td style="text-align:center;">---</td></tr></tbody>
               </table>`;
          }
       });
       
       htmlPage1 = `
         <div class="print-preview-container" style="padding: 0 !important; margin: 0 !important; ${otrosMachotes.length > 0 || examenesSimples.length > 0 ? 'page-break-after: always;' : ''}">
           ${this.getEncabezadoHTML()}
           ${headerHTML}
           ${tablaHema}
         </div>
       `;
    }

    // PAGE 2: Other Exams
    if (otrosMachotes.length > 0 || examenesSimples.length > 0) {
       let filasOtros = "";
       
       otrosMachotes.forEach(({ ex, machote }) => {
          filasOtros += `<tr style="background:#f1f5f9;"><td colspan="3" style="font-weight:bold; color:#0b1f3d;">${ex.nombre}</td></tr>`;
          machote.forEach((param, pIdx) => {
             const val = (orden.resultados[ex.codigo] && orden.resultados[ex.codigo][pIdx]) ? orden.resultados[ex.codigo][pIdx] : "";
             filasOtros += `<tr>
               <td style="padding-left: 20px;">${param.parametro}</td>
               <td style="text-align:center; font-weight:bold;">${val}</td>
               <td>${param.referencia}</td>
             </tr>`;
          });
       });

       examenesSimples.forEach(ex => {
          const r = (orden.resultados[ex.codigo] && orden.resultados[ex.codigo].texto) ? orden.resultados[ex.codigo].texto : "PENDIENTE";
          filasOtros += `<tr>
            <td style="font-weight:bold;">${ex.nombre}</td>
            <td style="text-align:center; font-weight:bold;">${r}</td>
            <td style="text-align:center;">---</td>
          </tr>`;
       });

       htmlPage2 = `
         <div class="print-preview-container" style="padding: 0 !important; margin: 0 !important;">
           ${this.getEncabezadoHTML()}
           ${headerHTML}
           <h3 style="text-align:center; margin: 15px 0 10px 0; font-size: 16px;">OTROS RESULTADOS</h3>
           <table class="print-exams-table" style="page-break-inside: avoid;">
             <thead>
               <tr>
                 <th>Análisis / Determinación</th>
                 <th style="text-align:center; width: 120px;">Resultado</th>
                 <th>Referencia</th>
               </tr>
             </thead>
             <tbody>${filasOtros}</tbody>
           </table>
         </div>
       `;
    }

    document.getElementById("contenidoOrden").innerHTML = htmlPage1 + htmlPage2;
    document.getElementById("modalDetalles").classList.remove("hidden");
  }

  editarDatosDesdeModal() {
    if (!this.ordenActualModal) return;
    const orden = this.ordenActualModal;

    Swal.fire({
      title: 'Editar Datos del Paciente',
      html: `
        <div style="text-align:left; padding: 10px;">
          <label style="font-size:12px; font-weight:bold;">Nombre:</label>
          <input id="swal-edit-nombre" class="swal2-input" value="${orden.paciente}">
          <label style="font-size:12px; font-weight:bold; margin-top:10px; display:block;">Edad:</label>
          <input id="swal-edit-edad" class="swal2-input" value="${orden.edad || ''}">
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      confirmButtonColor: '#1a4a7a',
      preConfirm: () => ({
        paciente: document.getElementById('swal-edit-nombre').value.trim(),
        edad: document.getElementById('swal-edit-edad').value.trim()
      })
    }).then(async res => {
      if (res.isConfirmed) {
        try {
          await this.manager.actualizarDatosPaciente(orden.correlativo, res.value);
          if (document.getElementById("modalDetalles").classList.contains("hidden")) return;

          if (Object.keys(orden.resultados || {}).length > 0) {
            this.verResultados(orden.correlativo);
          } else {
            this.verDetalles(orden.correlativo);
          }
          Swal.fire({ icon: 'success', title: 'Datos actualizados', timer: 1500, showConfirmButton: false });
        } catch (error) {
          showSyncError(error);
        }
      }
    });
  }

  abrirModalResultados(correlativo) {
    this.ordenActualParaResultados = this.manager.buscarOrden(correlativo);
    if (!this.ordenActualParaResultados) return;

    const clasif = this.ordenActualParaResultados.clasificacion || this.ordenActualParaResultados.genero || 'M';
    
    let html = `<h3 style="margin-bottom:15px; color:var(--primary-blue);"><i class="fa-solid fa-microscope"></i> Resultados - Orden #${String(this.ordenActualParaResultados.numero).padStart(7, '0')}</h3><div style="padding-right: 10px;">`;
    
    this.ordenActualParaResultados.examenes.forEach((e, exIdx) => {
      const liveExam = this.manager.examenes.find(ex => ex.codigo === e.codigo);
      const machote = (liveExam && liveExam.machotes) ? liveExam.machotes[clasif] : (e.machotes ? e.machotes[clasif] : null);
      const tieneMachote = machote && machote.length > 0;
      
      html += `<div style="margin-bottom: 25px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 15px; background: white;">`;
      html += `<h4 style="color: #003366; margin-bottom: 15px; border-bottom: 2px solid #e2e8f0; padding-bottom: 5px;">${e.nombre}</h4>`;
      
      if (tieneMachote) {
        html += `<div style="display: flex; flex-direction: column; gap: 8px;">`;
        
        machote.forEach((param, pIdx) => {
          const prev = (this.ordenActualParaResultados.resultados[e.codigo] && this.ordenActualParaResultados.resultados[e.codigo][pIdx]) ? this.ordenActualParaResultados.resultados[e.codigo][pIdx] : "";
          
          html += `
            <div style="display: flex; align-items: center; gap: 15px; padding: 8px; border-bottom: 1px solid #f1f5f9;">
              <div style="flex: 1; font-size: 14px; font-weight: 500; color: #334155;">${param.parametro}</div>
              <div style="width: 140px;">
                <input type="text" class="input-machote" id="res_${exIdx}_${pIdx}" value="${prev}" placeholder="..." style="width: 100%; text-align: center; font-weight: bold; border: 2px solid #cbd5e1; border-radius: 4px; padding: 6px; margin: 0; outline: none; transition: 0.2s;">
              </div>
              <div style="width: 180px; font-size: 12px; color: #64748b; text-align: right;">${param.referencia}</div>
            </div>
          `;
        });
        
        html += `</div>`;
      } else {
        const prev = (this.ordenActualParaResultados.resultados[e.codigo] && this.ordenActualParaResultados.resultados[e.codigo].texto) ? this.ordenActualParaResultados.resultados[e.codigo].texto : "";
        html += `
          <div style="display: flex; align-items: center; gap: 15px; padding: 8px; border-bottom: 1px solid #f1f5f9;">
            <div style="flex: 1; font-size: 14px; font-weight: 500; color: #334155;">${e.nombre}</div>
            <div style="width: 140px;">
              <input type="text" class="input-machote" id="res_${exIdx}_text" value="${prev}" placeholder="..." style="width: 100%; text-align: center; font-weight: bold; border: 2px solid #cbd5e1; border-radius: 4px; padding: 6px; margin: 0; outline: none; transition: 0.2s;">
            </div>
            <div style="width: 180px; font-size: 12px; color: #64748b; text-align: right;">---</div>
          </div>
        `;
      }
      html += `</div>`;
    });
    html += `</div>`;

    document.getElementById("contenidoResultados").innerHTML = html;
    document.getElementById("modalResultados").classList.remove("hidden");

    const inputs = document.querySelectorAll('.input-machote');
    if (inputs.length > 0) {
      setTimeout(() => inputs[0].focus(), 100);
    }

    inputs.forEach((input, index) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (index < inputs.length - 1) {
            inputs[index + 1].focus();
          } else {
            input.blur();
          }
        }
      });
    });
  }

  async procesarGuardarResultados() {
    const resultados = {};
    const clasif = this.ordenActualParaResultados.clasificacion || this.ordenActualParaResultados.genero || 'M';
    
    this.ordenActualParaResultados.examenes.forEach((e, exIdx) => {
      const liveExam = this.manager.examenes.find(ex => ex.codigo === e.codigo);
      const machote = (liveExam && liveExam.machotes) ? liveExam.machotes[clasif] : (e.machotes ? e.machotes[clasif] : null);
      const tieneMachote = machote && machote.length > 0;
      
      if (tieneMachote) {
        resultados[e.codigo] = {};
        machote.forEach((param, pIdx) => {
          resultados[e.codigo][pIdx] = document.getElementById(`res_${exIdx}_${pIdx}`).value;
        });
      } else {
        resultados[e.codigo] = { texto: document.getElementById(`res_${exIdx}_text`).value };
      }
    });

    try {
      await this.manager.guardarResultados(this.ordenActualParaResultados.correlativo, resultados);
      document.getElementById("modalResultados").classList.add("hidden");
      this.filtrarPorFecha();
      Swal.fire("¡Guardado!", "Resultados actualizados", "success");
    } catch (error) {
      showSyncError(error);
    }
  }

  eliminarOrden(correlativo) {
    Swal.fire({
      title: '🗑️ ¿Eliminar Orden?', text: `La orden será eliminada permanentemente`, icon: 'warning',
      showCancelButton: true, confirmButtonText: 'Sí, eliminar', confirmButtonColor: '#e74c3c'
    }).then(async (r) => {
      if (r.isConfirmed) {
        try {
          await this.manager.eliminarOrden(correlativo);
          this.filtrarPorFecha();
          Swal.fire("Eliminado", "Orden eliminada", "success");
        } catch (error) {
          showSyncError(error);
        }
      }
    });
  }

  // ===== EXÁMENES =====
  renderExamenes() {
    const tbody = document.querySelector("#tablaExamenes tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (this.manager.examenes.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:#94a3b8;">No hay exámenes registrados.</td></tr>`;
      return;
    }

    this.manager.examenes.forEach((e, index) => {
      const tieneMachote = e.machotes && (
        (e.machotes.M && e.machotes.M.length > 0) || 
        (e.machotes.F && e.machotes.F.length > 0) || 
        (e.machotes.N && e.machotes.N.length > 0)
      );
      
      tbody.innerHTML += `
        <tr>
          <td>${e.codigo}</td><td>${e.nombre}</td><td>Q${Number(e.precio).toFixed(2)}</td>
          <td>
            <button onclick="ui.abrirModalMachote(${index})" style="background:${tieneMachote ? '#8e44ad' : '#cbd5e1'};color:white;padding:5px 10px;border-radius:4px;font-size:12px;" title="Machote">
              <i class="fa-solid fa-file-medical-alt"></i> ${tieneMachote ? 'Editar' : 'Crear'}
            </button>
          </td>
          <td>
            <button onclick="ui.editarExamen(${index})" style="background:#eab308;color:white;padding:5px 10px;border-radius:4px;font-size:12px;margin-right:5px;" title="Editar"><i class="fa-solid fa-pen"></i></button>
            <button onclick="ui.prepararEspecificacion(${index})" style="background:#17a2b8;color:white;padding:5px 10px;border-radius:4px;font-size:12px;margin-right:5px;" title="Especificaciones"><i class="fa-solid fa-circle-info"></i></button>
            <button onclick="ui.confirmarEliminarExamen(${index})" style="background:#e74c3c;color:white;padding:5px 10px;border-radius:4px;font-size:12px;">Eliminar</button>
          </td>
        </tr>`;
    });
  }

  editarExamen(index) {
    const ex = this.manager.examenes[index];
    Swal.fire({
      title: 'Editar Examen',
      html: `
        <div style="display: flex; flex-direction: column; gap: 10px; text-align: left; padding: 10px;">
          <div>
            <label style="font-size: 12px; font-weight: bold; color: var(--text-light);">Código</label>
            <input id="edit-ex-cod" class="swal2-input" value="${ex.codigo}" style="margin: 0; width: 100%;">
          </div>
          <div>
            <label style="font-size: 12px; font-weight: bold; color: var(--text-light);">Nombre</label>
            <input id="edit-ex-nom" class="swal2-input" value="${ex.nombre}" style="margin: 0; width: 100%;">
          </div>
          <div>
            <label style="font-size: 12px; font-weight: bold; color: var(--text-light);">Precio</label>
            <input id="edit-ex-pre" type="number" class="swal2-input" value="${ex.precio}" style="margin: 0; width: 100%;">
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      confirmButtonColor: '#1E8449',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const cod = document.getElementById('edit-ex-cod').value.trim();
        const nom = document.getElementById('edit-ex-nom').value.trim();
        const pre = document.getElementById('edit-ex-pre').value;
        if (!cod || !nom || !pre) {
          Swal.showValidationMessage('Complete todos los campos');
          return false;
        }
        if (cod !== ex.codigo && this.manager.examenes.some(e => e.codigo === cod)) {
          Swal.showValidationMessage('El código ya existe en otro examen');
          return false;
        }
        return { codigo: cod, nombre: nom, precio: Number(pre) };
      }
    }).then(async res => {
      if (res.isConfirmed) {
        try {
          await this.manager.actualizarExamen(index, res.value);
          this.renderExamenes();
          this.renderChecklistExamenes();
          Swal.fire({ icon: 'success', title: 'Actualizado', timer: 1500, showConfirmButton: false });
        } catch (error) {
          showSyncError(error);
        }
      }
    });
  }

  abrirModalMachote(index) {
    this.machoteEditandoIndex = index;
    const examen = this.manager.examenes[index];
    
    if (!examen.machotes) examen.machotes = { M: [], F: [], N: [] };
    
    document.getElementById("modalMachoteTitle").innerHTML = `Editar Machote: <span style="color:var(--primary-blue)">${examen.nombre}</span>`;
    
    document.querySelectorAll('.machote-pane').forEach(p => p.style.display = 'none');
    document.getElementById('machoteTabM').style.display = 'block';
    
    ['M', 'F', 'N'].forEach(clasif => {
      const tbody = document.getElementById(`tbodyMachote${clasif}`);
      tbody.innerHTML = "";
      const params = examen.machotes[clasif] || [];
      
      if (params.length === 0) {
        this.agregarFilaMachote(clasif);
      } else {
        params.forEach(p => {
          tbody.innerHTML += `
            <tr>
              <td><input type="text" class="machote-param" value="${p.parametro || ''}" placeholder="Ej. Eritrosedimentacion"></td>
              <td><input type="text" class="machote-ref" value="${p.referencia || ''}" placeholder="Ej. 0 - 20 mm/hora"></td>
              <td style="text-align:center;"><button onclick="this.closest('tr').remove()" style="background:#e74c3c; color:white; border-radius:4px; padding:4px 8px;"><i class="fa-solid fa-trash"></i></button></td>
            </tr>
          `;
        });
      }
    });

    document.getElementById("modalMachote").classList.remove("hidden");
  }

  cambiarTabMachote(clasif, evt) {
    document.querySelectorAll('#modalMachote .tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.machote-pane').forEach(p => p.style.display = 'none');
    
    evt.target.classList.add('active');
    document.getElementById(`machoteTab${clasif}`).style.display = 'block';
  }

  agregarFilaMachote(clasif) {
    const tbody = document.getElementById(`tbodyMachote${clasif}`);
    tbody.innerHTML += `
      <tr>
        <td><input type="text" class="machote-param" value="" placeholder="Ej. Eritrosedimentacion"></td>
        <td><input type="text" class="machote-ref" value="" placeholder="Ej. 0 - 20 mm/hora"></td>
        <td style="text-align:center;"><button onclick="this.closest('tr').remove()" style="background:#e74c3c; color:white; border-radius:4px; padding:4px 8px;"><i class="fa-solid fa-trash"></i></button></td>
      </tr>
    `;
  }

  async guardarMachote() {
    if (this.machoteEditandoIndex === null) return;
    const examen = this.manager.examenes[this.machoteEditandoIndex];
    
    const extraerFilas = (clasif) => {
      const rows = document.querySelectorAll(`#tbodyMachote${clasif} tr`);
      const res = [];
      rows.forEach(tr => {
        const param = tr.querySelector('.machote-param').value.trim();
        const ref = tr.querySelector('.machote-ref').value.trim();
        if (param) {
          res.push({ parametro: param, referencia: ref });
        }
      });
      return res;
    };

    const machotes = {
      M: extraerFilas('M'),
      F: extraerFilas('F'),
      N: extraerFilas('N')
    };

    try {
      await window.firestore.saveExamen(examen.codigo, { ...examen, machotes });
      const currentExamen = this.manager.examenes.find(item => item.codigo === examen.codigo);
      if (currentExamen) currentExamen.machotes = machotes;
      document.getElementById("modalMachote").classList.add("hidden");
      this.renderExamenes();
      Swal.fire({icon: 'success', title: 'Machote guardado', timer: 1500, showConfirmButton: false});
    } catch (error) {
      showSyncError(error);
    }
  }

  async agregarExamen(cod, nom, pre, desc = "") {
    try {
      await this.manager.agregarExamen(cod, nom, pre, desc);
      this.renderExamenes();
      this.renderChecklistExamenes();
      return true;
    } catch (err) {
      showSyncError(err);
      return false;
    }
  }

  async eliminarExamen(index) {
    await this.manager.eliminarExamen(index);
    this.renderExamenes();
    this.renderChecklistExamenes();
  }

  prepararEspecificacion(index) {
    const examen = this.manager.examenes[index];
    Swal.fire({
      title: `Especificaciones: ${examen.nombre}`,
      input: 'textarea',
      inputLabel: 'Indicaciones o especificaciones del examen',
      inputValue: examen.descripcion || '',
      inputPlaceholder: 'Escriba las especificaciones aquí...',
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      confirmButtonColor: '#1a4a7a'
    }).then(async (res) => {
      if (res.isConfirmed) {
        try {
          const examen = this.manager.examenes[index];
          const actualizado = { ...examen, descripcion: res.value.trim() };
          await window.firestore.saveExamen(examen.codigo, actualizado);
          const currentIndex = this.manager.examenes.findIndex(item => item.codigo === examen.codigo);
          if (currentIndex !== -1) this.manager.examenes[currentIndex] = actualizado;
          Swal.fire({ icon: 'success', title: 'Especificación guardada', timer: 1500, showConfirmButton: false });
        } catch (error) {
          showSyncError(error);
        }
      }
    });
  }

  confirmarEliminarExamen(index) {
    const ex = this.manager.examenes[index];
    Swal.fire({
      title: '¿Eliminar examen?',
      text: `Se eliminará "${ex.nombre}" del catálogo.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#e74c3c',
      confirmButtonText: 'Sí, eliminar'
    }).then(async r => {
      if (r.isConfirmed) {
        try {
          await this.eliminarExamen(index);
          Swal.fire({ icon: 'success', title: 'Eliminado', timer: 1500, showConfirmButton: false });
        } catch (error) {
          showSyncError(error);
        }
      }
    });
  }

  // ===== SEGUROS =====
  renderSeguros() {
    const tbody = document.querySelector("#tablaSeguros tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (this.manager.seguros.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:#94a3b8;">No hay seguros registrados.</td></tr>`;
      return;
    }

    this.manager.seguros.forEach((s, i) => {
      tbody.innerHTML += `
        <tr>
          <td>${s.codigo}</td><td>${s.nombre}</td><td>${s.descuento}%</td>
          <td>
            <button onclick="ui.editarSeguro(${i})" style="background:#eab308;color:white;padding:5px 10px;border-radius:4px;font-size:12px;margin-right:5px;" title="Editar"><i class="fa-solid fa-pen"></i></button>
            <button onclick="ui.confirmarEliminarSeguro(${i})" style="background:#e74c3c;color:white;padding:5px 10px;border-radius:4px;font-size:12px;">Eliminar</button>
          </td>
        </tr>`;
    });
  }

  editarSeguro(index) {
    const s = this.manager.seguros[index];
    Swal.fire({
      title: 'Editar Seguro',
      html: `
        <div style="display: flex; flex-direction: column; gap: 10px; text-align: left; padding: 10px;">
          <div>
            <label style="font-size: 12px; font-weight: bold; color: var(--text-light);">Código</label>
            <input id="edit-seg-cod" class="swal2-input" value="${s.codigo}" style="margin: 0; width: 100%;">
          </div>
          <div>
            <label style="font-size: 12px; font-weight: bold; color: var(--text-light);">Nombre</label>
            <input id="edit-seg-nom" class="swal2-input" value="${s.nombre}" style="margin: 0; width: 100%;">
          </div>
          <div>
            <label style="font-size: 12px; font-weight: bold; color: var(--text-light);">Descuento (%)</label>
            <input id="edit-seg-desc" type="number" class="swal2-input" value="${s.descuento}" style="margin: 0; width: 100%;">
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      confirmButtonColor: '#1E8449',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const cod = document.getElementById('edit-seg-cod').value.trim();
        const nom = document.getElementById('edit-seg-nom').value.trim();
        const desc = document.getElementById('edit-seg-desc').value;
        if (!cod || !nom || desc === "") {
          Swal.showValidationMessage('Complete todos los campos');
          return false;
        }
        if (cod !== s.codigo && this.manager.seguros.some(seg => seg.codigo === cod)) {
          Swal.showValidationMessage('El código ya existe en otro seguro');
          return false;
        }
        return { codigo: cod, nombre: nom, descuento: Number(desc) };
      }
    }).then(async res => {
      if (res.isConfirmed) {
        try {
          await this.manager.actualizarSeguro(index, res.value);
          this.renderSeguros();
          Swal.fire({ icon: 'success', title: 'Actualizado', timer: 1500, showConfirmButton: false });
        } catch (error) {
          showSyncError(error);
        }
      }
    });
  }

  confirmarEliminarSeguro(index) {
    const s = this.manager.seguros[index];
    Swal.fire({
      title: '¿Eliminar seguro?',
      text: `Se eliminará el seguro "${s.nombre}".`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#e74c3c',
      confirmButtonText: 'Sí, eliminar'
    }).then(async r => {
      if (r.isConfirmed) {
        try {
          await this.manager.eliminarSeguro(index);
          this.renderSeguros();
          Swal.fire({ icon: 'success', title: 'Eliminado', timer: 1500, showConfirmButton: false });
        } catch (error) {
          showSyncError(error);
        }
      }
    });
  }

  // ===== DOCTORES =====
  renderDoctores() {
    const tbody = document.querySelector("#tablaDoctores tbody");
    const select = document.getElementById("doctorSelect");
    if (!tbody || !select) return;

    tbody.innerHTML = "";
    select.innerHTML = "<option value=''>Seleccione Doctor</option>";

    if (this.manager.doctores.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:25px;color:var(--text-light);">No hay doctores registrados.</td></tr>`;
      return;
    }

    this.manager.doctores.forEach((d, i) => {
      tbody.innerHTML += `
        <tr>
          <td>${d.dpi}</td><td><strong>${d.nombre}</strong></td><td>${d.especialidad}</td>
          <td><span style="background:${d.activo ? '#dcfce7' : '#fee2e2'};color:${d.activo ? '#166534' : '#991b1b'};padding:3px 8px;border-radius:4px;font-size:12px;font-weight:600;">${d.activo ? 'Activo' : 'Inactivo'}</span></td>
          <td>
            <button onclick="ui.editarDoctor(${i})" style="background:#eab308;color:white;padding:5px 10px;border-radius:4px;font-size:12px;margin-right:5px;" title="Editar"><i class="fa-solid fa-pen"></i></button>
            <button onclick="ui.confirmarEliminarDoctor(${i})" style="background:#e74c3c;color:white;padding:5px 10px;border-radius:4px;font-size:12px;">Eliminar</button>
          </td>
        </tr>`;
      select.innerHTML += `<option value="${d.nombre}">${d.nombre}</option>`;
    });
  }

  editarDoctor(index) {
    const doc = this.manager.doctores[index];
    Swal.fire({
      title: 'Editar Doctor',
      html: `
        <div style="display: flex; flex-direction: column; gap: 10px; text-align: left; padding: 10px;">
          <div>
            <label style="font-size: 12px; font-weight: bold; color: var(--text-light);">DPI</label>
            <input id="edit-doc-dpi" class="swal2-input" value="${doc.dpi}" style="margin: 0; width: 100%;">
          </div>
          <div>
            <label style="font-size: 12px; font-weight: bold; color: var(--text-light);">Nombre</label>
            <input id="edit-doc-nom" class="swal2-input" value="${doc.nombre}" style="margin: 0; width: 100%;">
          </div>
          <div>
            <label style="font-size: 12px; font-weight: bold; color: var(--text-light);">Especialidad</label>
            <input id="edit-doc-esp" class="swal2-input" value="${doc.especialidad}" style="margin: 0; width: 100%;">
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      confirmButtonColor: '#1E8449',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const dpi = document.getElementById('edit-doc-dpi').value.trim();
        const nom = document.getElementById('edit-doc-nom').value.trim();
        const esp = document.getElementById('edit-doc-esp').value.trim();
        if (!dpi || !nom || !esp) {
          Swal.showValidationMessage('Complete todos los campos');
          return false;
        }
        if (dpi !== doc.dpi && this.manager.doctores.some(d => d.dpi === dpi)) {
          Swal.showValidationMessage('El DPI ya existe en otro doctor');
          return false;
        }
        return { dpi, nombre: nom, especialidad: esp };
      }
    }).then(async (r) => {
      if (r.isConfirmed) {
        try {
          await this.manager.actualizarDoctor(index, r.value);
          this.renderDoctores();
          Swal.fire({ icon: 'success', title: 'Guardado', timer: 1500, showConfirmButton: false });
        } catch (error) {
          showSyncError(error);
        }
      }
    });
  }

  confirmarEliminarDoctor(index) {
    const doc = this.manager.doctores[index];
    Swal.fire({
      title: '¿Eliminar Doctor?', text: `Vas a eliminar a: ${doc.nombre}`, icon: 'warning',
      showCancelButton: true, confirmButtonColor: '#e74c3c', confirmButtonText: 'Sí, eliminar'
    }).then(async (r) => {
      if (r.isConfirmed) {
        try {
          await this.manager.eliminarDoctor(index);
          this.renderDoctores();
          Swal.fire({ icon: 'success', title: 'Eliminado', timer: 1500, showConfirmButton: false });
        } catch (error) {
          showSyncError(error);
        }
      }
    });
  }

  // ===== REPORTES =====
  cambiarTabReportes(tab) {
    document.querySelectorAll('#userReportes .tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#userReportes .tab-pane').forEach(p => p.classList.remove('active'));

    document.querySelector(`#userReportes .tab-btn[data-tab="${tab}"]`)?.classList.add('active');
    document.getElementById(`tab-reportes-${tab}`)?.classList.add('active');

    if (tab === 'comisiones') this.cargarReportes();
    if (tab === 'graficoDoctores') this.cargarGraficoDoctores();
    if (tab === 'graficoUsuarios') this.cargarGraficoUsuarios();
  }

  cargarReportes() {
    const porcentaje = parseInt(document.getElementById("porcentajeComision").value) || 10;
    const filtroDoctor = document.getElementById("filtroReporteDoctor")?.value || "todos";
    
    const comisiones = this.manager.calcularComisiones(porcentaje);

    const select = document.getElementById("filtroReporteDoctor");
    if (select && select.options.length <= 1) {
      this.manager.doctores.forEach(d => {
        select.innerHTML += `<option value="${d.nombre}">${d.nombre}</option>`;
      });
    }

    const tbody = document.querySelector("#tablaReportes tbody");
    if (!tbody) return;

    tbody.innerHTML = "";
    let totalPacientes = 0, totalGeneral = 0;

    Object.entries(comisiones).forEach(([doctor, datos]) => {
      if (filtroDoctor !== "todos" && filtroDoctor !== doctor) return;

      totalPacientes += datos.pacientes;
      totalGeneral += datos.total;
      tbody.innerHTML += `<tr><td style="font-weight:500;">${doctor}</td><td style="text-align:center;">${datos.pacientes}</td><td style="text-align:right;">Q${datos.total.toFixed(2)}</td><td style="text-align:right;color:#1E8449;font-weight:bold;">Q${datos.comision}</td></tr>`;
    });

    const totalComision = (totalGeneral * porcentaje / 100).toFixed(2);
    tbody.innerHTML += `<tr style="background:#003366 !important;color:white !important;font-weight:bold;"><td><strong>TOTAL ${filtroDoctor !== 'todos' ? '('+filtroDoctor+')' : 'GENERAL'}</strong></td><td style="text-align:center;"><strong>${totalPacientes}</strong></td><td style="text-align:right;"><strong>Q${totalGeneral.toFixed(2)}</strong></td><td style="text-align:right;"><strong>Q${totalComision}</strong></td></tr>`;
  }

  cargarGraficoDoctores() {
    const datos = {};
    this.manager.ordenes.forEach(o => { datos[o.doctor] = (datos[o.doctor] || 0) + 1; });

    const ctx = document.getElementById('ordenesChartDoctores')?.getContext('2d');
    if (!ctx) return;
    if (this._chartDoctores) this._chartDoctores.destroy();
    this._chartDoctores = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: Object.keys(datos),
        datasets: [{ 
          label: 'Órdenes', 
          data: Object.values(datos), 
          backgroundColor: '#1a4a7a', 
          borderRadius: 6,
          barPercentage: 0.6
        }]
      },
      options: { 
        responsive: true, 
        maintainAspectRatio: false, 
        plugins: { legend: { display: false } },
        scales: { 
          y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { display: false } },
          x: { grid: { display: false } }
        } 
      }
    });
  }

  cargarGraficoUsuarios() {
    const datos = {};
    this.manager.ordenes.forEach(o => {
      const user = o.creadoPor || 'desconocido';
      datos[user] = (datos[user] || 0) + 1;
    });

    const ctx = document.getElementById('usuariosPieChart')?.getContext('2d');
    if (!ctx) return;
    if (this._chartUsuarios) this._chartUsuarios.destroy();
    this._chartUsuarios = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: Object.keys(datos),
        datasets: [{ 
          data: Object.values(datos), 
          backgroundColor: ['#0b1f3d', '#1E8449', '#E67E22', '#e74c3c', '#8e44ad', '#3498db'],
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: { 
        responsive: true, 
        maintainAspectRatio: false, 
        plugins: { 
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } 
        },
        cutout: '65%'
      }
    });
  }

  imprimirReporte() {
    document.getElementById("btnEditarDatosModal").style.display = 'none';
    const porcentaje = document.getElementById("porcentajeComision").value || 10;
    const filtroDoctor = document.getElementById("filtroReporteDoctor").value;
    const comisiones = this.manager.calcularComisiones(porcentaje);
    
    let totalPacientes = 0, totalGeneral = 0;

    let html = `
      <div class="print-preview-container">
        ${this.getEncabezadoHTML()}
        <h3 style="text-align:center; margin-bottom:20px; font-size:16px;">REPORTE DE COMISIONES (${porcentaje}%) ${filtroDoctor !== 'todos' ? `- ${filtroDoctor}` : ''}</h3>
        <table class="print-exams-table">
          <thead><tr><th>Doctor</th><th style="text-align:center;">N° Pacientes</th><th style="text-align:right;">Monto Total</th><th style="text-align:right;">Comisión</th></tr></thead>
          <tbody>`;

    Object.entries(comisiones).forEach(([doctor, datos]) => {
      if (filtroDoctor !== "todos" && filtroDoctor !== doctor) return;

      totalPacientes += datos.pacientes; 
      totalGeneral += datos.total;
      html += `<tr><td>${doctor}</td><td style="text-align:center;">${datos.pacientes}</td><td style="text-align:right;">Q${datos.total.toFixed(2)}</td><td style="text-align:right; font-weight:bold;">Q${datos.comision}</td></tr>`;
    });

    const totalComision = (totalGeneral * porcentaje / 100).toFixed(2);
    html += `</tbody></table><div class="print-total" style="text-align:right;">TOTAL GENERAL: Q${totalComision}</div></div>`;
    document.getElementById("contenidoOrden").innerHTML = html;
    document.getElementById("modalDetalles").classList.remove("hidden");
  }

  enviarReporte() {
    Swal.fire({
      title: '📧 Enviar Reporte', input: 'email', inputLabel: 'Correo destino', inputPlaceholder: 'ejemplo@gmail.com', showCancelButton: true, confirmButtonText: 'Enviar'
    }).then(async (result) => {
      if (!result.isConfirmed) return;
      const email = result.value;
      if (!email) return Swal.fire("Error", "Ingrese un correo válido", "error");

      this.cargarReportes();
      const tabla = document.getElementById("tablaReportes").outerHTML;
      const porcentaje = document.getElementById("porcentajeComision").value || 10;
      const filtroDoctor = document.getElementById("filtroReporteDoctor")?.value || "todos";
      const docMsg = filtroDoctor !== 'todos' ? `<p><strong>Doctor Filtrado:</strong> ${filtroDoctor}</p>` : '';

      try {
        await emailjs.send("service_6aca2rm", "template_5cnvpro", { 
          to_email: email, 
          message: `<h2>Reporte de Comisiones</h2><p><strong>Porcentaje:</strong> ${porcentaje}%</p>${docMsg}${tabla}` 
        });
        Swal.fire("✅ Enviado", "El reporte fue enviado correctamente", "success");
      } catch (e) {
        Swal.fire("Error", "No se pudo enviar el correo", "error");
      }
    });
  }

  // ===== BITÁCORA / CAJA =====
  renderBitacora() {
    const tbody = document.querySelector('#tablaBitacora tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filtroMes = document.getElementById('filtroMesCaja')?.value;
    const cierres = this.manager.obtenerCierres(filtroMes);

    const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
    const mesActual = hoy.slice(0, 7);

    document.getElementById('cajaTotalDia').textContent = `Q ${this.manager.obtenerTotalDia(hoy).toFixed(2)}`;
    document.getElementById('cajaTotalMes').textContent = `Q ${this.manager.obtenerTotalMes(mesActual).toFixed(2)}`;
    document.getElementById('cajaMesLabel').textContent = mesActual;
    document.getElementById('cajaTotalAcumulado').textContent = `Q ${this.manager.obtenerTotalAcumulado().toFixed(2)}`;
    document.getElementById('cajaNumCierres').textContent = this.manager.obtenerCierres(mesActual).length;

    if (cierres.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:25px; color:#94a3b8;">No hay cierres registrados${filtroMes ? ' para este mes' : ''}.</td></tr>`;
      document.getElementById('cajaResumenMesText').textContent = '—';
      return;
    }

    let totalRango = 0;
    cierres.forEach((c, i) => {
      const tCaja = c.totalCaja || c.totalDia || 0;
      const nPac = c.numPacientes || 0;
      const exReal = c.examenesRealizados || 0;
      const tCant = c.tarjetaCant || 0;
      const tSaldo = c.tarjetaSaldo || 0;
      const eCant = c.efectivoCant || 0;
      const eSaldo = c.efectivoSaldo || 0;

      totalRango += tCaja;

      tbody.innerHTML += `
        <tr>
          <td>${i + 1}</td>
          <td style="text-align:right; font-weight:600;">Q ${tCaja.toFixed(2)}</td>
          <td style="text-align:center;">${nPac}</td>
          <td style="text-align:center;">${exReal}</td>
          <td style="text-align:center;">${tCant}</td>
          <td style="text-align:right; color:#3b82f6; font-weight:600;">Q ${tSaldo.toFixed(2)}</td>
          <td style="text-align:center;">${eCant}</td>
          <td style="text-align:right; color:#1E8449; font-weight:600;">Q ${eSaldo.toFixed(2)}</td>
          <td>
            <button class="btn-ver-comprobante" onclick="ui.imprimirComprobanteCaja('${c.id}')">Ver</button>
            <button class="btn-eliminar-cierre" onclick="ui.confirmarEliminarCierre('${c.id}')"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>`;
    });

    document.getElementById('cajaResumenMesText').innerHTML =
      `<strong>${cierres.length}</strong> cierre(s) — Total acumulado del rango: <strong>Q ${totalRango.toFixed(2)}</strong>`;
  }

  renderBitacoraAdmin() {
    const tbody = document.querySelector('#tablaBitacoraAdmin tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filtroMes = document.getElementById('filtroMesCajaAdmin')?.value;
    const cierres = this.manager.obtenerCierres(filtroMes);

    if (cierres.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:25px; color:#94a3b8;">No hay cierres registrados${filtroMes ? ' para este mes' : ''}.</td></tr>`;
      return;
    }

    cierres.forEach((c, i) => {
      const tCaja = c.totalCaja || c.totalDia || 0;
      const nPac = c.numPacientes || 0;
      const exReal = c.examenesRealizados || 0;
      const tCant = c.tarjetaCant || 0;
      const tSaldo = c.tarjetaSaldo || 0;
      const eCant = c.efectivoCant || 0;
      const eSaldo = c.efectivoSaldo || 0;

      tbody.innerHTML += `
        <tr>
          <td>${i + 1}</td>
          <td style="text-align:right; font-weight:600;">Q ${tCaja.toFixed(2)}</td>
          <td style="text-align:center;">${nPac}</td>
          <td style="text-align:center;">${exReal}</td>
          <td style="text-align:center;">${tCant}</td>
          <td style="text-align:right; color:#3b82f6; font-weight:600;">Q ${tSaldo.toFixed(2)}</td>
          <td style="text-align:center;">${eCant}</td>
          <td style="text-align:right; color:#1E8449; font-weight:600;">Q ${eSaldo.toFixed(2)}</td>
          <td>
            <button class="btn-ver-comprobante" onclick="ui.imprimirComprobanteCaja('${c.id}')">Ver</button>
            <button class="btn-eliminar-cierre" onclick="ui.confirmarEliminarCierre('${c.id}')"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>`;
    });
  }

  confirmarEliminarCierre(id) {
    Swal.fire({
      title: '¿Enviar a papelera?',
      text: 'El cierre se moverá a la papelera y podrás restaurarlo después.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, enviar',
      confirmButtonColor: '#e74c3c',
      cancelButtonText: 'Cancelar'
    }).then(async res => {
      if (res.isConfirmed) {
        try {
          await this.manager.eliminarCierreSoft(id);
          this.renderBitacora();
          this.renderBitacoraAdmin();
          Swal.fire('Enviado', 'El cierre está en la papelera.', 'success');
        } catch (error) {
          showSyncError(error);
        }
      }
    });
  }

  mostrarPapelera() {
    this.abrirModalPapelera(false);
  }

  mostrarPapeleraAdmin() {
    this.abrirModalPapelera(true);
  }

  abrirModalPapelera(esAdmin) {
    const papelera = this.manager.caja.papeleraCierres || [];
    if (papelera.length === 0) {
      return Swal.fire("Papelera Vacía", "No hay cierres eliminados.", "info");
    }

    let html = `<div style="max-height: 300px; overflow-y: auto; text-align: left;">
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
            <th style="padding: 8px;">Fecha</th>
            <th style="padding: 8px;">Total</th>
            <th style="padding: 8px;">Acciones</th>
          </tr>
        </thead>
        <tbody>`;

    papelera.forEach(c => {
      html += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px;">${c.fecha}</td>
          <td style="padding: 8px;">Q ${Number(c.totalCaja || 0).toFixed(2)}</td>
          <td style="padding: 8px;">
            <button onclick="ui.restaurarCierre('${c.id}')" style="background: #1E8449; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; margin-right: 5px; border: none; cursor: pointer;"><i class="fa-solid fa-rotate-left"></i> Restaurar</button>
            ${esAdmin ? `<button onclick="ui.eliminarDefinitivo('${c.id}')" style="background: #e74c3c; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; border: none; cursor: pointer;"><i class="fa-solid fa-trash-can"></i> Borrar</button>` : ''}
          </td>
        </tr>
      `;
    });

    html += `</tbody></table></div>`;

    Swal.fire({
      title: 'Papelera de Cierres',
      html: html,
      showConfirmButton: false,
      showCloseButton: true,
      width: '600px'
    });
  }

  async restaurarCierre(id) {
    try {
      await this.manager.restaurarCierre(id);
      this.renderBitacora();
      this.renderBitacoraAdmin();
      Swal.close();
      Swal.fire("Restaurado", "El cierre ha sido restaurado correctamente.", "success");
    } catch (error) {
      showSyncError(error);
    }
  }

  eliminarDefinitivo(id) {
    Swal.fire({
      title: '¿Borrar Definitivamente?',
      text: 'Esta acción no se puede deshacer y el registro se perderá para siempre.',
      icon: 'error',
      showCancelButton: true,
      confirmButtonText: 'Sí, borrar',
      confirmButtonColor: '#e74c3c',
      cancelButtonText: 'Cancelar'
    }).then(async res => {
      if (res.isConfirmed) {
        try {
          await this.manager.eliminarCierreDefinitivo(id);
          this.mostrarPapeleraAdmin();
          Swal.fire("Eliminado", "El cierre ha sido eliminado definitivamente.", "success");
        } catch (error) {
          showSyncError(error);
        }
      }
    });
  }

  cerrarCaja() {
    const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });

    if (this.manager.caja.cierres.some(c => c.fecha === hoy)) {
      return Swal.fire("Ya cerrado", `La caja de hoy (${hoy}) ya fue cerrada anteriormente.`, "warning");
    }

    const totalDia = this.manager.obtenerTotalDia(hoy);
    const mesActual = hoy.slice(0, 7);
    const totalMes = this.manager.obtenerTotalMes(mesActual);

    Swal.fire({
      title: '💰 Cerrar Caja',
      html: `
        <div style="text-align:left; font-size:14px;">
          <p><strong>📅 Fecha:</strong> ${hoy}</p>
          <p><strong>💰 Total del día:</strong> Q ${totalDia.toFixed(2)}</p>
          <p><strong>📊 Total del mes:</strong> Q ${totalMes.toFixed(2)}</p>
        </div>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: '✅ Cerrar Caja',
      confirmButtonColor: '#1E8449',
      cancelButtonText: 'Cancelar'
    }).then(async res => {
      if (!res.isConfirmed) return;
      try {
        const cierre = await this.manager.cerrarCaja(hoy, AuthManager.currentUser?.nombre || 'desconocido');
        this.renderBitacora();
        this.renderBitacoraAdmin();
        Swal.fire({
          title: '✅ Caja cerrada',
          html: `Total del día: <strong>Q ${cierre.totalCaja.toFixed(2)}</strong>`,
          icon: 'success',
          confirmButtonText: 'Ver comprobante'
        }).then(() => this.imprimirComprobanteCaja(cierre.id));
      } catch (err) {
        showSyncError(err);
      }
    });
  }

  imprimirComprobanteCaja(id) {
    document.getElementById("btnEditarDatosModal").style.display = 'none';
    const cierre = this.manager.caja.cierres.find(c => c.id === id);
    if (!cierre) return;
    const mesActual = cierre.fecha.slice(0, 7);
    const totalMes = this.manager.obtenerTotalMes(mesActual);

    const tCaja = cierre.totalCaja || cierre.totalDia || 0;
    const nPac = cierre.numPacientes || 0;
    const exReal = cierre.examenesRealizados || 0;
    const tCant = cierre.tarjetaCant || 0;
    const tSaldo = cierre.tarjetaSaldo || 0;
    const eCant = cierre.efectivoCant || 0;
    const eSaldo = cierre.efectivoSaldo || 0;

    const html = `
      <div class="print-preview-container">
        ${this.getEncabezadoHTML()}
        <div style="text-align:center; margin:20px 0;"><h3>COMPROBANTE DE CIERRE DE CAJA</h3></div>
        <table class="print-patient-table">
          <tr><th>Fecha:</th><td>${formatearFecha(cierre.fecha)}</td><th>Hora:</th><td>${cierre.horaCierre}</td></tr>
          <tr><th>Cerrado por:</th><td colspan="3">${cierre.cerradoPor}</td></tr>
        </table>
        <div class="print-divider"></div>
        <table class="print-exams-table" style="margin-bottom:15px;">
          <thead><tr><th>Concepto</th><th style="text-align:center;">Cant.</th><th style="text-align:right;">Monto (Q)</th></tr></thead>
          <tbody>
            <tr><td>Pagos con Tarjeta</td><td style="text-align:center;">${tCant}</td><td style="text-align:right;">Q ${tSaldo.toFixed(2)}</td></tr>
            <tr><td>Pagos en Efectivo</td><td style="text-align:center;">${eCant}</td><td style="text-align:right;">Q ${eSaldo.toFixed(2)}</td></tr>
            <tr style="background:#f8fafc; font-weight:bold;"><td>TOTAL EN CAJA</td><td style="text-align:center;">${nPac} pac.</td><td style="text-align:right;">Q ${tCaja.toFixed(2)}</td></tr>
          </tbody>
        </table>
        <p style="font-size:16px;"><strong>Exámenes realizados:</strong> ${exReal}</p>
        <p style="font-size:16px;"><strong>Total acumulado del mes (${mesActual}):</strong> Q ${totalMes.toFixed(2)}</p>
        <div class="print-divider"></div>
        <div style="margin-top:40px; text-align:center;">_________________________<br>Responsable</div>
      </div>`;
    document.getElementById("contenidoOrden").innerHTML = html;
    document.getElementById("modalDetalles").classList.remove("hidden");
  }

  imprimirBitacora() {
    document.getElementById("btnEditarDatosModal").style.display = 'none';
    const filtroMes = document.getElementById('filtroMesCaja')?.value;
    const cierres = this.manager.obtenerCierres(filtroMes);
    if (cierres.length === 0) return Swal.fire("Info", "No hay cierres para imprimir.", "info");

    let totalRango = 0;
    let filas = '';
    cierres.forEach((c, i) => {
      const tCaja = c.totalCaja || c.totalDia || 0;
      const nPac = c.numPacientes || 0;
      const exReal = c.examenesRealizados || 0;
      const tCant = c.tarjetaCant || 0;
      const tSaldo = c.tarjetaSaldo || 0;
      const eCant = c.efectivoCant || 0;
      const eSaldo = c.efectivoSaldo || 0;

      totalRango += tCaja;
      filas += `<tr>
        <td>${i + 1}</td><td>${formatearFecha(c.fecha)}</td>
        <td style="text-align:right;">Q${tCaja.toFixed(2)}</td>
        <td style="text-align:center;">${nPac}</td>
        <td style="text-align:center;">${exReal}</td>
        <td style="text-align:center;">${tCant}</td>
        <td style="text-align:right;">Q${tSaldo.toFixed(2)}</td>
        <td style="text-align:center;">${eCant}</td>
        <td style="text-align:right;">Q${eSaldo.toFixed(2)}</td>
      </tr>`;
    });

    const html = `
      <div class="print-preview-container">
        ${this.getEncabezadoHTML()}
        <h3 style="text-align:center; margin:20px 0;">BITÁCORA DE CIERRES DE CAJA ${filtroMes ? '(' + filtroMes + ')' : ''}</h3>
        <table class="print-exams-table" style="font-size: 12px;">
          <thead>
            <tr>
              <th>No.</th><th>Fecha</th><th>Total Caja</th>
              <th>Pac.</th><th>Exáms.</th>
              <th>Tarj. (Cant)</th><th>Saldo Tarj.</th>
              <th>Efect. (Cant)</th><th>Saldo Efect.</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
        <div class="print-total" style="text-align:right;">TOTAL: Q ${totalRango.toFixed(2)}</div>
      </div>`;
    document.getElementById("contenidoOrden").innerHTML = html;
    document.getElementById("modalDetalles").classList.remove("hidden");
  }

  exportarExcelOrdenes() {
    const ordenes = this.manager.ordenes;
    if (!ordenes.length) return Swal.fire("Info", "No hay órdenes para exportar.", "info");

    const data = ordenes.map(o => ({
      "Número Orden": String(o.numero).padStart(7, '0'),
      "Correlativo": String(o.correlativo || o.numero).padStart(7, '0'),
      "Fecha": formatearFecha(o.fecha),
      "Paciente": o.paciente,
      "Clasificación": o.clasificacion || 'M',
      "Doctor": o.doctor,
      "Edad": o.edad || '',
      "Seguro": o.tipoSeguro || '',
      "Método Pago": o.metodoPago || 'Efectivo',
      "Recargo %": o.recargoPct || 0,
      "Total Original": Number(o.totalOriginal || 0).toFixed(2),
      "Descuento": Number(o.descuentoQ || 0).toFixed(2),
      "Total Final": Number(o.total || 0).toFixed(2),
      "Recibido": Number(o.recibido || 0).toFixed(2),
      "Cambio": Number(o.cambio || 0).toFixed(2),
      "Creado por": o.creadoPor || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ordenes");
    XLSX.writeFile(wb, `ordenes_lab_${new Date().toISOString().slice(0, 10)}.xlsx`);
    
    Swal.fire("Éxito", "Respaldo Excel (.xlsx) descargado correctamente", "success");
  }
}

// ============================================================================
// 6. ADMIN CONTROLLER
// ============================================================================

class AdminController {
  static toggleDropdown(event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    const dropdown = document.getElementById('adminDropdownMenu');
    const chevron = document.getElementById('adminChevron');
    if (dropdown) {
      const isShowing = dropdown.classList.contains('show') || dropdown.style.display === 'block';
      if (isShowing) {
        dropdown.classList.remove('show');
        dropdown.style.display = 'none';
        if (chevron) chevron.style.transform = 'rotate(0deg)';
      } else {
        dropdown.classList.add('show');
        dropdown.style.display = 'block';
        if (chevron) chevron.style.transform = 'rotate(180deg)';
      }
    }
  }

  static cerrarDropdown() {
    const dropdown = document.getElementById('adminDropdownMenu');
    const chevron = document.getElementById('adminChevron');
    if (dropdown) { dropdown.classList.remove('show'); dropdown.style.display = 'none'; }
    if (chevron) chevron.style.transform = 'rotate(0deg)';
  }

  static cambiarModo(modo) {
    this.cerrarDropdown();

    if (modo === 'admin') {
      document.getElementById('userApp').classList.add('hidden');
      document.getElementById('adminApp').classList.remove('hidden');
      document.getElementById('adminHeaderTitle').textContent = 'Panel de Administración';
      this.cargarEstadisticas();
    } else if (modo === 'laboratorio') {
      document.getElementById('adminApp').classList.add('hidden');
      document.getElementById('userApp').classList.remove('hidden');
      document.getElementById('satUserDisplay').textContent = AuthManager.currentUser.nombre;
      document.getElementById('satRoleDisplay').textContent = "MODO LABORATORIO";
      document.getElementById('welcomeName').textContent = AuthManager.currentUser.nombre;
      document.getElementById('btnVolverAdmin').style.display = 'block';

      AuthManager.aplicarPermisos(AuthManager.currentUser);
      AuthManager.ui.renderDoctores();
      AuthManager.ui.renderExamenes();
      AuthManager.ui.renderSeguros();
      AuthManager.ui.filtrarPorFecha();
      AuthManager.ui.actualizarNotificaciones();
      AuthManager.ui.actualizarNavbarFoto(); 
      AuthManager.mostrarVistaUsuario('userHome');
    }
  }

  static volverModoAdmin() { this.cambiarModo('admin'); }

  static cargarEstadisticas() {
    const lab = AuthManager.lab;
    const totalVentas = lab.ordenes.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const totalOrdenes = lab.ordenes.length;
    const pacientesUnicos = new Set(lab.ordenes.map(o => (o.paciente || '').trim().toLowerCase())).size;
    const pendientes = lab.ordenes.filter(o => Object.keys(o.resultados || {}).length === 0).length;

    document.getElementById('statVentas').textContent = `Q ${totalVentas.toFixed(2)}`;
    document.getElementById('statOrdenes').textContent = totalOrdenes;
    document.getElementById('statPacientes').textContent = pacientesUnicos;
    document.getElementById('statPendientes').textContent = pendientes;

    // ESTADÍSTICAS ADICIONALES
    const examCount = {};
    const classCount = { M: 0, F: 0, N: 0 };

    lab.ordenes.forEach(o => {
      const clasif = o.clasificacion || o.genero || 'M';
      if (classCount[clasif] !== undefined) classCount[clasif]++;

      if (o.examenes) {
        o.examenes.forEach(ex => {
          examCount[ex.nombre] = (examCount[ex.nombre] || 0) + 1;
        });
      }
    });

    let maxEx = 'N/A', minEx = 'N/A', maxC = 0, minC = Infinity;
    const entries = Object.entries(examCount);
    
    if (entries.length > 0) {
      entries.forEach(([name, count]) => {
        if (count > maxC) { maxC = count; maxEx = name; }
        if (count < minC) { minC = count; minEx = name; }
      });
    }

    document.getElementById('statExamenMas').textContent = maxEx;
    document.getElementById('statExamenMasCant').textContent = `${maxC} veces realizadas`;
    document.getElementById('statExamenMenos').textContent = minEx;
    document.getElementById('statExamenMenosCant').textContent = `${minC === Infinity ? 0 : minC} veces realizadas`;
    
    document.getElementById('statHombres').textContent = classCount.M;
    document.getElementById('statMujeres').textContent = classCount.F;
    document.getElementById('statNinos').textContent = classCount.N;

    // GRÁFICO Y TOP DOCTORES
    const chart = document.getElementById('chartIngresos');
    chart.innerHTML = '';
    const ultimas = lab.ordenes.slice(-6);

    if (ultimas.length === 0) {
      chart.innerHTML = `<p style="color:#94a3b8; width:100%; text-align:center;">No hay ingresos registrados aún.</p>`;
    } else {
      const maxTotal = Math.max(...ultimas.map(o => Number(o.total || 0)), 1);
      ultimas.forEach(o => {
        const height = ((Number(o.total) || 0) / maxTotal) * 100;
        chart.innerHTML += `
          <div style="flex:1; background: #3b82f6; height: ${height}%; border-radius: 4px 4px 0 0; text-align: center; color: white; font-size: 10px; padding-top: 5px; position:relative;" title="Q${Number(o.total).toFixed(2)}">
            Q${Number(o.total).toFixed(0)}
          </div>`;
      });
    }

    const comisiones = lab.calcularComisiones(10);
    const top = Object.entries(comisiones)
      .filter(([_, data]) => data.pacientes > 0)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 3);

    const tbody = document.getElementById('topDoctoresBody');
    tbody.innerHTML = "";
    if (top.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#94a3b8;">No hay datos de doctores aún.</td></tr>`;
      return;
    }
    top.forEach(([name, data]) => {
      tbody.innerHTML += `<tr><td>${name}</td><td>${data.pacientes}</td><td style="color: #1E8449; font-weight: bold;">Q ${data.comision}</td></tr>`;
    });
  }

  static renderTablaUsuarios() {
    const tbody = document.querySelector("#tablaUsuariosAdmin tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    Object.entries(AuthManager.users).forEach(([username, data]) => {
      tbody.innerHTML += `<tr><td><strong>${username}</strong></td><td>${data.nombre}</td><td><span style="background:#e2e8f0;padding:4px 8px;border-radius:4px;font-size:12px;">${data.rol}</span></td><td>${username !== 'admin' ? `<button class="btn-danger" onclick="AuthManager.eliminarUsuario('${username}')"><i class="fa-solid fa-trash"></i> Eliminar</button>` : '<i>Protegido</i>'}</td></tr>`;
    });
  }

  static renderPermisosUsuarios() {
    const tbody = document.querySelector("#tablaPermisosUsuarios tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    Object.entries(AuthManager.users).forEach(([username, data]) => {
      const tieneCustom = data.permisos ? '<span style="color:#1E8449; font-weight:bold;">Sí</span>' : '<span style="color:#64748b;">No (Por defecto)</span>';
      
      tbody.innerHTML += `
        <tr>
          <td><strong>${username}</strong></td>
          <td>${data.nombre}</td>
          <td><span style="background:#e2e8f0;padding:4px 8px;border-radius:4px;font-size:12px;">${data.rol}</span></td>
          <td>${tieneCustom}</td>
          <td>
            <button class="btn-primary" onclick="ui.abrirModalPermisos('${username}')" style="padding: 5px 10px; font-size: 12px;">
              <i class="fa-solid fa-shield-halved"></i> Dar Permisos
            </button>
          </td>
        </tr>
      `;
    });
  }
}

// ============================================================================
// 7. AUTH MANAGER
// ============================================================================

class AuthManager {
  static defaultUsers = {
    "admin":     { pass: "admin123",  rol: "admin",         nombre: "Administrador General" },
   
  };

  static users = Database.load('lab_users', AuthManager.defaultUsers);
  static settings = Database.load('lab_settings', { showDoctores: true });
  static currentUser = null;
  static lab = null;
  static ui  = null;
  static subscriptions = [];

  static async initLab() {
    this.users = await loadUsersWithLegacy();
    const settings = await window.firestore.getSettings();
    if (settings) {
      this.settings = settings;
      localStorage.setItem("lab_firestore_migrated_settings", "true");
    } else {
      const marker = "lab_firestore_migrated_settings";
      if (!localStorage.getItem(marker)) {
        this.settings = Database.load("lab_settings", { showDoctores: true });
        await window.firestore.saveSettings(this.settings);
        localStorage.setItem(marker, "true");
      } else {
        this.settings = { showDoctores: true };
      }
    }

    this.lab = new LaboratoryManager();
    await this.lab.init();
    this.ui = new UIManager(this.lab);
    solicitudes = await loadCollectionWithLegacy("solicitudes", "solicitudes", "id");
    this.subscribeToChanges();
  }

  static subscribeToChanges() {
    if (this.subscriptions.length > 0) return;

    const watchCollection = (name, callback) => {
      this.subscriptions.push(window.firestore.watchAll(name, (data) => {
        try {
          callback(data);
        } catch (error) {
          showSyncError(error);
        }
      }, showSyncError));
    };

    watchCollection("doctores", (data) => {
      this.lab.doctores = data;
      this.ui.renderDoctores();
    });
    watchCollection("examenes", (data) => {
      this.lab.examenes = data;
      this.ui.renderExamenes();
    });
    watchCollection("ordenes", (data) => {
      this.lab.ordenes = data;
      this.ui.filtrarPorFecha();
      const dashboard = document.getElementById("adminDashboard");
      if (dashboard && !dashboard.classList.contains("hidden")) {
        AdminController.cargarEstadisticas();
      }
    });
    watchCollection("seguros", (data) => {
      this.lab.seguros = data;
      this.ui.renderSeguros();
    });
    watchCollection("solicitudes", (data) => {
      solicitudes = data;
      this.ui.actualizarNotificaciones();
      const listaColaboraciones = document.getElementById("vistaDoctoresColaboraciones");
      const detalleColaboraciones = document.getElementById("vistaDetalleColaboraciones");
      if (listaColaboraciones && !listaColaboraciones.classList.contains("hidden")) {
        this.ui.renderColaboraciones();
      } else if (detalleColaboraciones && !detalleColaboraciones.classList.contains("hidden")) {
        const doctor = document.getElementById("nombreDoctorColab").textContent;
        this.ui.verSolicitudesDoctor(doctor);
      }
      const misSolicitudes = document.getElementById("userMisSolicitudes");
      if (misSolicitudes && !misSolicitudes.classList.contains("hidden")) {
        this.ui.renderMisSolicitudes();
      }
    });
    watchCollection("users", (data) => {
      this.users = Object.fromEntries(data.map(({ id, ...user }) => [id, user]));
      AdminController.renderTablaUsuarios();
      AdminController.renderPermisosUsuarios();
      if (this.currentUser && this.users[this.currentUser.username]) {
        this.currentUser = { ...this.users[this.currentUser.username], username: this.currentUser.username };
        this.aplicarPermisos(this.currentUser);
      }
    });

    this.subscriptions.push(window.firestore.watch("caja", "config", (data) => {
      if (!data) return;
      this.lab.caja = data;
      const userBitacora = document.getElementById("userBitacora");
      if (userBitacora && !userBitacora.classList.contains("hidden")) {
        this.ui.renderBitacora();
      }
      const adminFacturacion = document.getElementById("adminFacturacion");
      if (adminFacturacion && !adminFacturacion.classList.contains("hidden")) {
        this.ui.renderBitacoraAdmin();
      }
    }, showSyncError));
    this.subscriptions.push(window.firestore.watch("settings", "config", (data) => {
      if (data) this.settings = data;
    }, showSyncError));
  }

  static getDefaultPermissions(rol) {
    if (rol === 'doctor') {
      return { 
        menuInicio: true, menuResultados: false, menuNuevaOrden: false, menuExamenes: false, menuReportes: false, menuBitacora: false,
        menuSolicitar: true, menuMisSolicitudes: true, dropDoctores: false, dropSeguros: false, dropColaboraciones: false 
      };
    } else if (rol === 'laboratorista') {
      return { 
        menuInicio: true, menuResultados: true, menuNuevaOrden: true, menuExamenes: false, menuReportes: false, menuBitacora: true,
        menuSolicitar: false, menuMisSolicitudes: false, dropDoctores: true, dropSeguros: true, dropColaboraciones: true 
      };
    }
    return { 
      menuInicio: true, menuResultados: true, menuNuevaOrden: true, menuExamenes: true, menuReportes: true, menuBitacora: true,
      menuSolicitar: false, menuMisSolicitudes: false, dropDoctores: true, dropSeguros: true, dropColaboraciones: true 
    };
  }

  static init() {
    window.addEventListener('click', (event) => {
      if (!event.target.closest('.admin-profile-container')) AdminController.cerrarDropdown();
      if (!event.target.closest('.user-dropdown-container')) {
        const dd = document.getElementById('userDropdownMenu');
        if (dd) dd.classList.remove('show');
      }
    });
  }

  static login() {
    const userKey = document.getElementById("user").value.trim();
    const pass    = document.getElementById("pass").value.trim();
    const user    = this.users[userKey];

    if (!user || user.pass !== pass) return Swal.fire("Error", "Usuario o contraseña incorrectos", "error");

    this.currentUser = { ...user, username: userKey };
    document.getElementById("loginView").classList.add("hidden");
    AdminController.cerrarDropdown();

    if (user.rol === "admin") {
      document.getElementById("adminApp").classList.remove("hidden");
      document.getElementById("adminNameDisplay").textContent = user.nombre;
      AdminController.renderTablaUsuarios();
      AdminController.cambiarModo('admin');
    } else {
      document.getElementById("userApp").classList.remove("hidden");
      document.getElementById("satUserDisplay").textContent = user.nombre;
      document.getElementById("satRoleDisplay").textContent = user.rol.toUpperCase();
      document.getElementById("welcomeName").textContent = user.nombre;
      document.getElementById('btnVolverAdmin').style.display = 'none';

      this.aplicarPermisos(this.currentUser);
      document.getElementById("filtroFecha").value = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });

      this.ui.renderDoctores();
      this.ui.renderExamenes();
      this.ui.renderSeguros();
      this.ui.filtrarPorFecha();
      this.ui.actualizarNotificaciones();
      this.ui.actualizarNavbarFoto(); 
      this.mostrarVistaUsuario('userHome');
    }

    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `Bienvenido, ${user.nombre}`, showConfirmButton: false, timer: 2000 });
  }

  static logout() {
    Swal.fire({
      title: '¿Cerrar sesión?', icon: 'question', showCancelButton: true, confirmButtonText: 'Sí, salir', confirmButtonColor: '#d33'
    }).then((result) => {
      if (result.isConfirmed) {
        this.currentUser = null;
        document.getElementById("user").value = "";
        document.getElementById("pass").value = "";
        document.getElementById("adminApp").classList.add("hidden");
        document.getElementById("userApp").classList.add("hidden");
        document.getElementById("loginView").classList.remove("hidden");
      }
    });
  }

  static aplicarPermisos(userObj) {
    const rol = userObj.rol;
    const username = userObj.username;

    const perms = userObj.permisos || this.getDefaultPermissions(rol);

    const setDisplay = (id, isVisible, isFlex = false) => {
      const el = document.getElementById(id);
      if (el) el.style.display = isVisible ? (isFlex ? 'flex' : 'block') : 'none';
    };

    setDisplay('menuInicio', perms.menuInicio !== false);
    setDisplay('menuResultados', perms.menuResultados);
    setDisplay('menuNuevaOrden', perms.menuNuevaOrden);
    setDisplay('menuExamenes', perms.menuExamenes);
    setDisplay('menuReportes', perms.menuReportes);
    setDisplay('menuBitacora', perms.menuBitacora);
    setDisplay('menuSolicitar', perms.menuSolicitar);
    setDisplay('menuMisSolicitudes', perms.menuMisSolicitudes);

    setDisplay('dropColaboraciones', perms.dropColaboraciones, true);
    setDisplay('dropDoctores', perms.dropDoctores, true);
    setDisplay('dropSeguros', perms.dropSeguros, true);
    setDisplay('dropBitacora', perms.menuBitacora, true);

    setDisplay('homeNuevaOrden', perms.menuNuevaOrden);
    setDisplay('homeDashboard', perms.menuResultados);
    setDisplay('homeSolicitar', perms.menuSolicitar);

    if (rol === 'admin' && username === 'admin') {
      setDisplay('menuBitacora', false); 
    }
  }

  static async toggleSeccionDoctores() {
    const checked = document.getElementById('toggleDoctores').checked;
    const updatedSettings = { ...this.settings, showDoctores: checked };
    try {
      await window.firestore.saveSettings(updatedSettings);
      this.settings = updatedSettings;
    } catch (error) {
      showSyncError(error);
      document.getElementById('toggleDoctores').checked = this.settings.showDoctores;
      return;
    }
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: checked ? 'Sección Doctores: VISIBLE' : 'Sección Doctores: OCULTA', showConfirmButton: false, timer: 2000 });
  }

  static async crearUsuarioAdmin() {
    const nombre = document.getElementById('newUserName').value.trim();
    const user   = document.getElementById('newUserUser').value.trim().toLowerCase();
    const pass   = document.getElementById('newUserPass').value.trim();
    const rol    = document.getElementById('newUserRole').value;

    if (!nombre || !user || !pass) return Swal.fire("Error", "Llene todos los campos", "error");
    if (this.users[user]) return Swal.fire("Error", "El usuario ya existe", "error");

    const newUser = { nombre, pass, rol };
    try {
      await window.firestore.saveUser(user, newUser);
      this.users[user] = newUser;
    } catch (error) {
      return showSyncError(error);
    }

    document.getElementById('newUserName').value = "";
    document.getElementById('newUserUser').value = "";
    document.getElementById('newUserPass').value = "";

    AdminController.renderTablaUsuarios();
    AdminController.renderPermisosUsuarios();
    Swal.fire("Éxito", "Usuario creado", "success");
  }

  static eliminarUsuario(username) {
    Swal.fire({ title: '¿Eliminar usuario?', text: `Se borrará a ${username}`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'Eliminar' }).then(async (r) => {
      if (r.isConfirmed) {
        try {
          await window.firestore.deleteUser(username);
          delete this.users[username];
          AdminController.renderTablaUsuarios();
          AdminController.renderPermisosUsuarios();
          Swal.fire("Eliminado", "Usuario borrado", "success");
        } catch (error) {
          showSyncError(error);
        }
      }
    });
  }

  static mostrarVistaUsuario(viewId) {
    document.querySelectorAll('.user-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId)?.classList.remove('hidden');

    document.getElementById('satSidebar')?.classList.remove('show');
    document.getElementById('userDropdownMenu')?.classList.remove('show');

    if (viewId === 'userDoctores')       this.ui.renderDoctores();
    if (viewId === 'userSeguros')        this.ui.renderSeguros();
    if (viewId === 'userDashboard')      this.ui.filtrarPorFecha();
    if (viewId === 'userExamenes')       this.ui.renderExamenes();
    if (viewId === 'userReportes')       this.ui.cargarReportes();
    if (viewId === 'userColaboraciones') this.ui.renderColaboraciones();
    if (viewId === 'userPerfil')         this.ui.renderPerfil();
    if (viewId === 'userMisSolicitudes') {
      this.ui.renderMisSolicitudes();
      this.ui.actualizarNotificaciones();
    }
    if (viewId === 'userHome') {
      this.ui.actualizarNotificaciones();
    }
    if (viewId === 'userBitacora') {
      const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
      const filtro = document.getElementById('filtroMesCaja');
      if (filtro && !filtro.value) filtro.value = hoy.slice(0, 7);
      this.ui.renderBitacora();
    }
    if (viewId === 'userNuevaOrden') {
      this.ui.irAPaso1();
      ["nombrePaciente","fechaNacimiento","edadPaciente","doctorSelect","buscarExamen"]
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
      document.getElementById("tipoSeguro").value = "Ninguno";
      document.getElementById("clasificacionPaciente").value = "M";
    }
  }

  static mostrarVistaAdmin(viewId) {
    document.querySelectorAll('.admin-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId)?.classList.remove('hidden');

    if (viewId === 'adminPermisos') {
      AdminController.renderPermisosUsuarios();
    }
    if (viewId === 'adminFacturacion') {
      const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
      const filtro = document.getElementById('filtroMesCajaAdmin');
      if (filtro && !filtro.value) filtro.value = hoy.slice(0, 7);
      this.ui.renderBitacoraAdmin();
    }

    document.querySelectorAll('.sidebar-menu a').forEach(a => a.classList.remove('active'));
    if (typeof event !== 'undefined' && event && event.target) {
      const link = event.target.closest('a');
      if (link) link.classList.add('active');
    }
  }
}

// ============================================================================
// 8. FUNCIONES GLOBALES
// ============================================================================

AuthManager.init();
const loginButton = document.querySelector("#loginView button");
loginButton.disabled = true;
loginButton.textContent = "Conectando con el sistema...";
window.addEventListener("DOMContentLoaded", async () => {
  try {
    await AuthManager.initLab();
    loginButton.disabled = false;
    loginButton.textContent = "Ingresar al Sistema";
  } catch (error) {
    console.error("No se pudo inicializar el sistema:", error);
    loginButton.textContent = "Error de conexión. Recargue la página";
    Swal.fire("Error de conexión", "No se pudo sincronizar con Firestore. Verifique la conexión e intente nuevamente.", "error");
  }
});

window.cerrarModal = () => document.getElementById("modalDetalles").classList.add("hidden");
window.cerrarModalResultados = () => document.getElementById("modalResultados").classList.add("hidden");
window.cerrarModalCobro = () => document.getElementById("modalCobro").classList.add("hidden");

// FUNCIÓN PARA FORMATEAR FECHAS A DD/MM/YYYY
window.formatearFecha = (fechaStr) => {
  if (!fechaStr) return "";
  const partes = fechaStr.split('-');
  if (partes.length === 3) {
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  }
  return fechaStr;
};

window.buscarTabla = (input, tablaId) => {
  const filtro = input.value.toLowerCase();
  document.querySelectorAll(`#${tablaId} tbody tr`).forEach(fila => {
    fila.style.display = fila.textContent.toLowerCase().includes(filtro) ? "" : "none";
  });
};

window.toggleAdminDropdown   = (e) => AdminController.toggleDropdown(e);
window.cambiarModoAdmin      = (modo) => AdminController.cambiarModo(modo);
window.volverModoAdmin       = () => AdminController.volverModoAdmin();

window.login                 = () => AuthManager.login();
window.logout                = () => AuthManager.logout();
window.showUserView          = (v) => AuthManager.mostrarVistaUsuario(v);
window.showAdminView         = (v) => AuthManager.mostrarVistaAdmin(v);
window.toggleSeccionDoctores = () => AuthManager.toggleSeccionDoctores();
window.crearUsuarioAdmin     = () => AuthManager.crearUsuarioAdmin();
window.eliminarUsuario       = (u) => AuthManager.eliminarUsuario(u);

window.toggleAdminSidebar    = () => document.getElementById('adminApp').classList.toggle('sidebar-collapsed');
window.toggleSatMenu         = () => document.getElementById('satSidebar').classList.toggle('show');
window.toggleUserDropdown    = () => document.getElementById('userDropdownMenu').classList.toggle('show');

window.procesarGuardarOrdenConPago = async () => {
  const totalBase = AuthManager.ui.totalActual - AuthManager.ui.descuentoQ;
  const metodo = AuthManager.ui.metodoPago;
  const recibido = parseFloat(document.getElementById("pagoRecibido").value) || 0;
  
  let totalFinal = totalBase;
  let recargoPct = 0;
  
  if (metodo === 'Tarjeta') {
    recargoPct = AuthManager.ui.recargoPct;
    totalFinal = totalBase + (totalBase * recargoPct / 100);
  } else {
    if (recibido < totalFinal) {
      return Swal.fire("Atención", "El monto recibido es menor al total a pagar.", "warning");
    }
  }

  const cambio = metodo === 'Efectivo' ? (recibido - totalFinal) : 0;

  const paciente = document.getElementById("nombrePaciente").value.trim();
  const clasificacion = document.getElementById("clasificacionPaciente").value;
  const edad = document.getElementById("edadPaciente").value.trim() || "No especificada";
  const doctor = document.getElementById("doctorSelect").value;
  const seguro = document.getElementById("tipoSeguro").value;

  let orden;
  try {
    orden = await AuthManager.lab.crearOrden({
      paciente, doctor,
      examenesSeleccionados: AuthManager.ui.examenesSeleccionados,
      total: totalFinal, descuentoQ: AuthManager.ui.descuentoQ, totalOriginal: AuthManager.ui.totalActual, edad,
      tipoSeguro: seguro, clasificacion,
      metodoPago: metodo, recargoPct, recibido, cambio
    });
  } catch (error) {
    return showSyncError(error);
  }

  ["nombrePaciente","fechaNacimiento","edadPaciente","buscarExamen"]
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  document.getElementById("doctorSelect").value = "";
  document.getElementById("tipoSeguro").value = "Ninguno";
  document.getElementById("clasificacionPaciente").value = "M";
  
  cerrarModalCobro();
  AuthManager.ui.irAPaso1();
  AuthManager.ui.filtrarPorFecha();

  Swal.fire({
    icon: 'success',
    title: '¡Orden Generada!',
    html: `Orden #${String(orden.numero).padStart(7, '0')} <br> Correlativo #${String(orden.correlativo).padStart(7, '0')} <br><br> Total cobrado: <b>Q${totalFinal.toFixed(2)}</b>`,
    confirmButtonText: 'Ver Resultados'
  }).then(res => { if (res.isConfirmed) showUserView('userDashboard'); });
};

window.agregarDoctor = async () => {
  const dpi = document.getElementById("docDpi").value.trim();
  const nom = document.getElementById("docNombre").value.trim();
  const esp = document.getElementById("docEsp").value.trim();

  if (!dpi || !nom || !esp) return Swal.fire("Error", "Llene todos los campos", "error");

  if (!AuthManager.lab) {
    return Swal.fire("Error", "El sistema aún se está cargando, intente de nuevo en unos segundos", "warning");
  }

  try {
    await AuthManager.lab.agregarDoctor(dpi, nom, esp);
    AuthManager.ui.renderDoctores();
    document.getElementById("docDpi").value = "";
    document.getElementById("docNombre").value = "";
    document.getElementById("docEsp").value = "";
    Swal.fire({ icon: 'success', title: '¡Doctor Afiliado!', text: `${nom} fue agregado correctamente`, timer: 2000, showConfirmButton: false });
  } catch (err) {
    Swal.fire("Error", err.message, "error");
  }
};

window.agregarSeguro = async () => {
  const codigo = document.getElementById("segCodigo").value.trim();
  const nombre = document.getElementById("segNombre").value.trim();
  const descuento = document.getElementById("segDescuento").value;

  if (!codigo || !nombre || descuento === "") return Swal.fire("Error", "Llene todos los campos", "error");

  try {
    await AuthManager.lab.agregarSeguro(codigo, nombre, descuento);
    AuthManager.ui.renderSeguros();
    document.getElementById("segCodigo").value = "";
    document.getElementById("segNombre").value = "";
    document.getElementById("segDescuento").value = "";
    Swal.fire({ icon: 'success', title: '¡Seguro Agregado!', text: `${nombre} fue registrado correctamente`, timer: 2000, showConfirmButton: false });
  } catch (err) {
    Swal.fire("Error", err.message, "error");
  }
};

window.agregarExamen = async () => {
  const c = document.getElementById("exCod").value.trim();
  const n = document.getElementById("exNom").value.trim();
  const p = document.getElementById("exPre").value;

  if (!c || !n || !p) return Swal.fire("Error", "Complete todos los campos", "error");

  const ok = await AuthManager.ui.agregarExamen(c, n, p);
  if (ok) {
    document.getElementById("exCod").value = "";
    document.getElementById("exNom").value = "";
    document.getElementById("exPre").value = "";
    Swal.fire({ icon: 'success', title: 'Examen agregado', timer: 1500, showConfirmButton: false });
  }
};
