// ============================================================================
// FIRESTORE SERVICE - Reemplaza a Database (localStorage)
// ============================================================================

import { db } from "./firebase-config.js";
import {
  collection, doc, setDoc, getDoc, getDocs,
  addDoc, deleteDoc, updateDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

class FirestoreService {
  constructor() {
    this.collections = [
      "doctores", "examenes", "ordenes", "seguros",
      "solicitudes", "caja", "users"
    ];
  }

  // ===== GUARDAR (crear o actualizar) =====
  async save(collectionName, id, data) {
    try {
      const docRef = doc(db, collectionName, id);
      await setDoc(docRef, data, { merge: true });
      return { success: true, id };
    } catch (e) {
      console.error(`Error guardando en ${collectionName}:`, e);
      throw e;
    }
  }

  // ===== CARGAR UN SOLO DOCUMENTO =====
  async load(collectionName, id) {
    try {
      const docRef = doc(db, collectionName, id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data();
      }
      return null;
    } catch (e) {
      console.error(`Error cargando ${collectionName}/${id}:`, e);
      return null;
    }
  }

  // ===== CARGAR TODOS LOS DOCUMENTOS DE UNA COLECCIÓN =====
  async loadAll(collectionName) {
    try {
      const q = query(collection(db, collectionName), orderBy("createdAt", "desc"));
      const querySnapshot = await getDocs(q);
      const data = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() });
      });
      return data;
    } catch (e) {
      console.error(`Error cargando todo de ${collectionName}:`, e);
      return [];
    }
  }

  // ===== ELIMINAR =====
  async delete(collectionName, id) {
    try {
      await deleteDoc(doc(db, collectionName, id));
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
}

export const firestore = new FirestoreService();
window.firestore = firestore;
console.log("✅ Firestore Service listo");