// src/components/Auth/Register.js
import React, { useState } from "react";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth } from "../../firebase/config";
import { Link, useNavigate } from "react-router-dom";
import "./Auth.css";

const Register = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (e) => {
    e.preventDefault();
    
    if (!name || !email || !password || !confirmPassword) {
      setError("Por favor, preencha todos os campos.");
      return;
    }
    
    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    
    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    
    try {
      setError("");
      setLoading(true);
      
      // Criar usuário
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      
      // Atualizar perfil com nome
      await updateProfile(userCredential.user, {
        displayName: name
      });
      
      navigate("/select-categories"); // Redirecionar para seleção de categorias
    } catch (error) {
      console.error("Erro ao registrar:", error);
      
      if (error.code === "auth/email-already-in-use") {
        setError("Este email já está em uso.");
      } else {
        setError("Erro ao criar conta. Tente novamente.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h2>Registro</h2>
        {error && <div className="error-message">{error}</div>}
        <form onSubmit={handleRegister}>
          <div className="form-group">
            <label>Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome completo"
            />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Seu email"
            />
          </div>
          <div className="form-group">
            <label>Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Sua senha"
            />
          </div>
          <div className="form-group">
            <label>Confirmar Senha</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirme sua senha"
            />
          </div>
          <button type="submit" disabled={loading}>
            {loading ? "Carregando..." : "Registrar"}
          </button>
        </form>
        <p className="auth-link">
          Já tem uma conta? <Link to="/login">Faça login</Link>
        </p>
      </div>
    </div>
  );
};

export default Register;