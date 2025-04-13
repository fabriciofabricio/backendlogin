// src/components/Settings/AccountForm.js
import React, { useState, useRef } from "react";
import { auth, db } from "../../firebase/config";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { updateEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "firebase/auth";

const AccountForm = ({ user, setError, setSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [showReAuth, setShowReAuth] = useState(false);
  
  // Usar refs para os valores dos campos para evitar re-renderização a cada digitação
  const displayNameRef = useRef(user?.displayName || "");
  const emailRef = useRef(user?.email || "");
  const currentPasswordRef = useRef("");
  const newPasswordRef = useRef("");
  const reAuthPasswordRef = useRef("");
  
  // Função para salvar mudanças de perfil
  const handleSaveProfile = async () => {
    try {
      setLoading(true);
      setError("");
      setSuccess("");
      
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("Usuário não autenticado.");
      }
      
      // Pegar valores atuais dos refs
      const displayName = displayNameRef.current.value;
      const email = emailRef.current.value;
      const currentPassword = currentPasswordRef.current?.value;
      const newPassword = newPasswordRef.current?.value;
      const reAuthPassword = reAuthPasswordRef.current?.value;
      
      // Atualizar displayName no Firestore (se implementado)
      const userDocRef = doc(db, "users", currentUser.uid);
      const userDoc = await getDoc(userDocRef);
      
      if (userDoc.exists()) {
        await updateDoc(userDocRef, {
          displayName: displayName,
          updatedAt: serverTimestamp()
        });
      }
      
      // Atualizar email (requer reautenticação)
      if (email !== currentUser.email) {
        if (!reAuthPassword) {
          setShowReAuth(true);
          return;
        }
        
        try {
          // Reautenticar usuário
          const credential = EmailAuthProvider.credential(
            currentUser.email,
            reAuthPassword
          );
          
          await reauthenticateWithCredential(currentUser, credential);
          
          // Atualizar email
          await updateEmail(currentUser, email);
          
          setShowReAuth(false);
          if (reAuthPasswordRef.current) {
            reAuthPasswordRef.current.value = "";
          }
        } catch (authError) {
          console.error("Erro de autenticação:", authError);
          setError("Senha atual incorreta ou erro ao atualizar email.");
          return;
        }
      }
      
      // Atualizar senha (se fornecida)
      if (newPassword && currentPassword) {
        try {
          // Reautenticar usuário
          const credential = EmailAuthProvider.credential(
            currentUser.email,
            currentPassword
          );
          
          await reauthenticateWithCredential(currentUser, credential);
          
          // Atualizar senha
          await updatePassword(currentUser, newPassword);
          
          // Limpar campos de senha
          if (currentPasswordRef.current) currentPasswordRef.current.value = "";
          if (newPasswordRef.current) newPasswordRef.current.value = "";
          setShowPasswordChange(false);
        } catch (authError) {
          console.error("Erro ao alterar senha:", authError);
          setError("Senha atual incorreta ou erro ao atualizar senha.");
          return;
        }
      }
      
      setSuccess("Perfil atualizado com sucesso!");
      
      // Limpar mensagem após 3 segundos
      setTimeout(() => {
        setSuccess("");
      }, 3000);
      
    } catch (error) {
      console.error("Erro ao salvar perfil:", error);
      setError(`Erro ao atualizar perfil: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Cancelar reautenticação
  const cancelReAuth = () => {
    setShowReAuth(false);
    if (reAuthPasswordRef.current) {
      reAuthPasswordRef.current.value = "";
    }
    if (emailRef.current) {
      emailRef.current.value = user?.email || "";
    }
  };

  return (
    <div className="settings-tab-content">
      <h3>Informações da Conta</h3>
      
      <div className="settings-form">
        <div className="form-group">
          <label htmlFor="displayName">Nome</label>
          <input
            type="text"
            id="displayName"
            ref={displayNameRef}
            defaultValue={user?.displayName || ""}
            disabled={loading}
          />
        </div>
        
        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input
            type="email"
            id="email"
            ref={emailRef}
            defaultValue={user?.email || ""}
            disabled={loading}
          />
        </div>
        
        {showPasswordChange ? (
          <>
            <div className="form-group">
              <label htmlFor="currentPassword">Senha Atual</label>
              <input
                type="password"
                id="currentPassword"
                ref={currentPasswordRef}
                disabled={loading}
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="newPassword">Nova Senha</label>
              <input
                type="password"
                id="newPassword"
                ref={newPasswordRef}
                disabled={loading}
              />
            </div>
            
            <div className="password-actions">
              <button 
                className="cancel-button"
                onClick={() => setShowPasswordChange(false)}
                disabled={loading}
              >
                Cancelar
              </button>
            </div>
          </>
        ) : (
          <button 
            className="show-password-button"
            onClick={() => setShowPasswordChange(true)}
            disabled={loading}
          >
            Alterar Senha
          </button>
        )}
        
        <button 
          className="save-button"
          onClick={handleSaveProfile}
          disabled={loading}
        >
          {loading ? "Salvando..." : "Salvar Alterações"}
        </button>
      </div>
      
      {/* Modal de reautenticação (se necessário para alterar email) */}
      {showReAuth && (
        <div className="reauth-modal-overlay">
          <div className="reauth-modal">
            <h4>Verifique sua Identidade</h4>
            <p>Para alterar seu email, precisamos confirmar sua senha atual.</p>
            
            <div className="form-group">
              <label htmlFor="reAuthPassword">Senha Atual</label>
              <input
                type="password"
                id="reAuthPassword"
                ref={reAuthPasswordRef}
              />
            </div>
            
            <div className="reauth-buttons">
              <button 
                className="cancel-button"
                onClick={cancelReAuth}
              >
                Cancelar
              </button>
              
              <button 
                className="confirm-button"
                onClick={handleSaveProfile}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountForm;