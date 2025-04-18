// src/App.js
import React, { useState, useEffect, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase/config";
import Login from "./components/Auth/Login";
import Register from "./components/Auth/Register";
import CategorySelection from "./components/Auth/CategorySelection";
import Dashboard from "./components/Dashboard/Dashboard";
import DREReport from "./components/DRE/DREReport";
import CategoryDetails from "./components/Categories/CategoryDetails";
import Transactions from "./components/Transactions/Transactions";
import NonCategorized from "./components/Transactions/NonCategorized";
import EditCategorized from "./components/Transactions/EditCategorized";
import PeriodManager from "./components/Periods/PeriodManager";
import CashEntry from "./components/CashEntry/CashEntry";
import Settings from "./components/Settings/Settings";
import Charts from "./components/Charts/Charts";
import "./App.css";

// Componente que renderiza condicionalmente os componentes com base na rota
function PersistentComponents() {
  const location = useLocation();
  const [loaded, setLoaded] = useState(false);
  const [currentPath, setCurrentPath] = useState("");
  
  // Efeito para carregar os componentes após montagem inicial
  useEffect(() => {
    setLoaded(true);
    
    // Atualizar o caminho atual para comparação
    setCurrentPath(decodeURIComponent(location.pathname));
    
    // Se estamos na rota raiz, redirecionar para o dashboard
    if (location.pathname === "/" || location.pathname === "") {
      window.location.href = "/dashboard";
    }
  }, [location.pathname]);
  
  // Helper function para determinar qual componente mostrar
  const shouldRender = (path) => {
    // Se estamos na rota raiz, mostre o dashboard por padrão
    if (currentPath === "/" || currentPath === "") {
      return path === "/dashboard";
    }
    
    // Comparação normalizada para lidar com caracteres especiais
    return currentPath === path || 
           decodeURIComponent(currentPath) === path ||
           currentPath === decodeURIComponent(path);
  };
  
  // Debug para ver na console o caminho atual
  useEffect(() => {
    console.log("Caminho atual:", currentPath);
  }, [currentPath]);
  
  return (
    <>
      {loaded && (
        <>
          {shouldRender("/select-categories") && <CategorySelection />}
          {shouldRender("/dashboard") && <Dashboard />}
          {shouldRender("/dre") && <DREReport />}
          {shouldRender("/charts") && <Charts />}
          {shouldRender("/transactions") && <Transactions />}
          {shouldRender("/categorias") && <CategoryDetails />}
          {(shouldRender("/não-categorizados") || shouldRender("/nao-categorizados")) && <NonCategorized />}
          {shouldRender("/editar-categorizados") && <EditCategorized />}
          {shouldRender("/periods") && <PeriodManager />}
          {shouldRender("/cash-entry") && <CashEntry />}
          {shouldRender("/settings") && <Settings />}
        </>
      )}
    </>
  );
}

// Rota protegida que requer autenticação
const ProtectedRoute = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return <div className="app-loading">Carregando...</div>;
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  return children;
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        {/* Rota raiz explícita redirecionando para dashboard */}
        <Route path="/" element={<Navigate to="/dashboard" />} />
        {/* Rotas explícitas para URLs com caracteres especiais */}
        <Route 
          path="/não-categorizados" 
          element={
            <ProtectedRoute>
              <PersistentComponents />
            </ProtectedRoute>
          } 
        />
        {/* Rota curinga que captura todas as rotas protegidas */}
        <Route 
          path="/*" 
          element={
            <ProtectedRoute>
              <PersistentComponents />
            </ProtectedRoute>
          } 
        />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    </Router>
  );
}

export default App;