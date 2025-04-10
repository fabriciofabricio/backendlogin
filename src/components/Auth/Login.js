// src/components/Auth/Login.js
import React, { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../../firebase/config";
import { Link, useNavigate } from "react-router-dom";
import "./Auth.css";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    
    if (!email || !password) {
      setError("Por favor, preencha todos os campos.");
      return;
    }
    
    try {
      setError("");
      setLoading(true);
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/dashboard"); // Redirecione para sua página após login
    } catch (error) {
      console.error("Erro ao fazer login:", error);
      setError(
        error.code === "auth/user-not-found" || error.code === "auth/wrong-password"
          ? "Email ou senha incorretos."
          : "Falha ao fazer login. Tente novamente."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h2>Login</h2>
        {error && <div className="error-message">{error}</div>}
        <form onSubmit={handleLogin}>
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
          <button type="submit" disabled={loading}>
            {loading ? "Carregando..." : "Entrar"}
          </button>
        </form>
        <p className="auth-link">
          Não tem uma conta? <Link to="/register">Registre-se</Link>
        </p>
      </div>
    </div>
  );
};

export default Login;