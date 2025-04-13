// src/App.js
import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
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
        <Route 
          path="/select-categories" 
          element={
            <ProtectedRoute>
              <CategorySelection />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/dre" 
          element={
            <ProtectedRoute>
              <DREReport />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/charts" 
          element={
            <ProtectedRoute>
              <Charts />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/transactions" 
          element={
            <ProtectedRoute>
              <Transactions />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/categorias" 
          element={
            <ProtectedRoute>
              <CategoryDetails />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/não-categorizados" 
          element={
            <ProtectedRoute>
              <NonCategorized />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/editar-categorizados" 
          element={
            <ProtectedRoute>
              <EditCategorized />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/periods" 
          element={
            <ProtectedRoute>
              <PeriodManager />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/cash-entry" 
          element={
            <ProtectedRoute>
              <CashEntry />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/settings" 
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          } 
        />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    </Router>
  );
}

export default App;