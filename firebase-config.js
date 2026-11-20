// ============================================================================
// CONFIGURACIÓN DE FIREBASE - Sistema Lab
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Tu configuración de Firebase (obtenida de la consola)
const firebaseConfig = {
  apiKey: "AIzaSyCpU1ZqlEmA5gnWRwS3IPjCUXBdFl2iiHM",
  authDomain: "sistema-lab-d9465.firebaseapp.com",
  projectId: "sistema-lab-d9465",
  storageBucket: "sistema-lab-d9465.firebasestorage.app",
  messagingSenderId: "949399947739",
  appId: "1:949399947739:web:6469308f8ded98dd3abffe"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);

// Inicializar Firestore y exportarlo para usarlo en otros archivos
export const db = getFirestore(app);

console.log("✅ Firebase conectado correctamente");