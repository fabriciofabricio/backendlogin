// src/firebase/config.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Substitua estas configurações pelas suas credenciais do Firebase
const firebaseConfig = {
    apiKey: "AIzaSyBtebhcdey4IYevl8BWYLoDlL65YJW7YcQ",
    authDomain: "drecenna.firebaseapp.com",
    projectId: "drecenna",
    storageBucket: "drecenna.firebasestorage.app",
    messagingSenderId: "814636054008",
    appId: "1:814636054008:web:17d5b7741660e61af8520d",
    measurementId: "G-02HWSCX207"
  };

// Inicialize o Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { auth, db, storage };