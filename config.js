// ============================================================
//  CONFIGURACIÓN DE LA APP DE REGALOS
// ============================================================
//
// 1) Configuración de tu proyecto de Firebase
//    (Firebase console → Settings → General → Your apps → Web).
//    Si apiKey está vacío, la app corre en "modo demo":
//    los datos sólo se guardan en este navegador (no se comparten).
//
export const firebaseConfig = {
  apiKey: "AIzaSyD92gJ2gEzdU5wkUsJWRN_3oRUwxcYd2N0",
  authDomain: "boda-952ac.firebaseapp.com",
  projectId: "boda-952ac",
  storageBucket: "boda-952ac.firebasestorage.app",
  messagingSenderId: "620292575166",
  appId: "1:620292575166:web:d40e9ae7ac1aa8444a73ef",
  measurementId: "G-PTMGBPPKC5",
};

// 1b) Correo del usuario compartido que creaste en Firebase
//     (Authentication → Users → Add user). La app sólo pide la contraseña.
export const USUARIO = "entregas@boda-jarillo.app";

// 2) Nombres de las personas que van a entregar (aparecen como botones
//    la primera vez que alguien abre la app en su teléfono).
export const ENTREGADORES = ["Lulu", "Lolita", "Jesus", "Camila","Regina"];

// 3) PIN para abrir el panel de administración (importar / borrar lista).
//    Ojo: es sólo para evitar accidentes, no es seguridad real.
export const ADMIN_PIN = "2026";

// 4) Título que se ve arriba.
export const TITULO = "Regalos de la boda";
