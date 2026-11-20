// ============================================================================
// FIRESTORE SERVICE - Reemplaza a Database (localStorage)
// ============================================================================

import { db } from "./firebase-config.js";
import {
  collection, doc, setDoc, getDoc, getDocs,
  deleteDoc, onSnapshot, runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

class FirestoreService {
  constructor() {
    this.collections = [
      "doctores", "examenes", "ordenes", "seguros",
      "solicitudes", "caja", "users", "settings", "counters"
    ];
  }

  // ===== GUARDAR (crear o actualizar) =====
  async save(collectionName, id, data) {
    try {
      const docRef = doc(db, collectionName, String(id));
      await setDoc(docRef, data, { merge: true });
      return { success: true, id };
    } catch (e) {
      console.error(`Error guardando en ${collectionName}:`, e);
      throw e;
    }
  }

  // ===== CARGAR UN SOLO DOCUMENTO =====
  async load(collectionName, id) {
    const docSnap = await getDoc(doc(db, collectionName, String(id)));
    return docSnap.exists() ? docSnap.data() : null;
  }

  // ===== CARGAR TODOS LOS DOCUMENTOS DE UNA COLECCIÓN =====
  async loadAll(collectionName) {
    const querySnapshot = await getDocs(collection(db, collectionName));
    return querySnapshot.docs.map((snapshot) => ({
      ...snapshot.data(),
      id: snapshot.id
    }));
  }

  watchAll(collectionName, onData, onError) {
    return onSnapshot(
      collection(db, collectionName),
      (snapshot) => onData(snapshot.docs.map((document) => ({
        ...document.data(),
        id: document.id
      }))),
      onError
    );
  }

  watch(collectionName, id, onData, onError) {
    return onSnapshot(
      doc(db, collectionName, String(id)),
      (snapshot) => onData(snapshot.exists() ? snapshot.data() : null),
      onError
    );
  }

  async saveAll(collectionName, items, idField) {
    await Promise.all(items.map((item) => {
      const id = item[idField];
      if (id === undefined || id === null || id === "") {
        throw new Error(`Falta el identificador "${idField}" para guardar en ${collectionName}.`);
      }
      return this.save(collectionName, String(id), item);
    }));
    return { success: true, count: items.length };
  }

  async move(collectionName, oldId, newId, data) {
    const oldRef = doc(db, collectionName, String(oldId));
    const newRef = doc(db, collectionName, String(newId));
    await runTransaction(db, async (transaction) => {
      const newSnapshot = await transaction.get(newRef);
      if (newSnapshot.exists()) {
        throw new Error(`Ya existe un registro con identificador "${newId}" en ${collectionName}.`);
      }
      transaction.set(newRef, data);
      transaction.delete(oldRef);
    });
  }

  async initializeOrderCounters(orders, currentDate) {
    const globalRef = doc(db, "counters", "ordenes");
    const dailyRef = doc(db, "counters", `ordenes_${currentDate}`);
    const maxCorrelativo = orders.reduce(
      (max, order) => Math.max(max, Number(order.correlativo) || 0),
      0
    );
    const maxNumero = orders
      .filter((order) => order.fecha === currentDate)
      .reduce((max, order) => Math.max(max, Number(order.numero) || 0), 0);

    await runTransaction(db, async (transaction) => {
      const globalSnapshot = await transaction.get(globalRef);
      const dailySnapshot = await transaction.get(dailyRef);
      if (!globalSnapshot.exists()) {
        transaction.set(globalRef, { lastCorrelativo: maxCorrelativo });
      }
      if (!dailySnapshot.exists()) {
        transaction.set(dailyRef, { lastNumero: maxNumero });
      }
    });
  }

  async createOrder(order, maxCorrelativo, maxNumero) {
    const globalRef = doc(db, "counters", "ordenes");
    const dailyRef = doc(db, "counters", `ordenes_${order.fecha}`);

    return runTransaction(db, async (transaction) => {
      const globalSnapshot = await transaction.get(globalRef);
      const dailySnapshot = await transaction.get(dailyRef);
      const correlativo = Math.max(
        Number(globalSnapshot.data()?.lastCorrelativo) || 0,
        maxCorrelativo
      ) + 1;
      const numero = Math.max(
        Number(dailySnapshot.data()?.lastNumero) || 0,
        maxNumero
      ) + 1;
      const savedOrder = { ...order, correlativo, numero };

      transaction.set(doc(db, "ordenes", String(correlativo)), savedOrder);
      transaction.set(globalRef, { lastCorrelativo: correlativo });
      transaction.set(dailyRef, { lastNumero: numero });
      return savedOrder;
    });
  }

  // ===== ELIMINAR =====
  async delete(collectionName, id) {
    try {
      await deleteDoc(doc(db, collectionName, String(id)));
      return { success: true };
    } catch (e) {
      console.error(`Error eliminando ${collectionName}/${id}:`, e);
      throw e;
    }
  }

  // ===== MÉTODOS ESPECÍFICOS PARA TU SISTEMA =====

  // Doctores
  async getDoctores() { return this.loadAll("doctores"); }
  async saveDoctor(id, data) { return this.save("doctores", id, data); }
  async deleteDoctor(id) { return this.delete("doctores", id); }

  // Exámenes
  async getExamenes() { return this.loadAll("examenes"); }
  async saveExamen(id, data) { return this.save("examenes", id, data); }
  async deleteExamen(id) { return this.delete("examenes", id); }

  // Órdenes
  async getOrdenes() { return this.loadAll("ordenes"); }
  async saveOrden(id, data) { return this.save("ordenes", id, data); }
  async deleteOrden(id) { return this.delete("ordenes", id); }

  // Seguros
  async getSeguros() { return this.loadAll("seguros"); }
  async saveSeguro(id, data) { return this.save("seguros", id, data); }
  async deleteSeguro(id) { return this.delete("seguros", id); }

  // Solicitudes
  async getSolicitudes() { return this.loadAll("solicitudes"); }
  async saveSolicitud(id, data) { return this.save("solicitudes", id, data); }
  async deleteSolicitud(id) { return this.delete("solicitudes", id); }

  // Caja (se guarda como un solo documento con id "config")
  async getCaja() { return this.load("caja", "config"); }
  async saveCaja(data) { return this.save("caja", "config", data); }

  // Usuarios
  async getUsers() { return this.loadAll("users"); }
  async saveUser(id, data) { return this.save("users", id, data); }
  async deleteUser(id) { return this.delete("users", id); }

  // Configuración compartida
  async getSettings() { return this.load("settings", "config"); }
  async saveSettings(data) { return this.save("settings", "config", data); }
}

export const firestore = new FirestoreService();
window.firestore = firestore;
console.log("✅ Firestore Service listo");