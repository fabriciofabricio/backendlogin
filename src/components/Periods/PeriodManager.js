// src/components/Periods/PeriodManager.js
import React, { useState, useEffect } from "react";
import { auth, db, storage } from "../../firebase/config";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  deleteDoc, 
  doc,
  orderBy,
  serverTimestamp,
  addDoc
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import MainLayout from "../Layout/MainLayout";
import "./PeriodManager.css";

const PeriodManager = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [periods, setPeriods] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  
  // Estados para o formulário de novo período
  const [file, setFile] = useState(null);
  const [month, setMonth] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  
  // Criar array de meses para o select
  const months = [
    { value: "01", label: "Janeiro" },
    { value: "02", label: "Fevereiro" },
    { value: "03", label: "Março" },
    { value: "04", label: "Abril" },
    { value: "05", label: "Maio" },
    { value: "06", label: "Junho" },
    { value: "07", label: "Julho" },
    { value: "08", label: "Agosto" },
    { value: "09", label: "Setembro" },
    { value: "10", label: "Outubro" },
    { value: "11", label: "Novembro" },
    { value: "12", label: "Dezembro" }
  ];
  
  // Criar array de anos (últimos 5 anos)
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  // Carregar usuário e períodos existentes
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setLoading(true);
        
        if (auth.currentUser) {
          setUser(auth.currentUser);
          await loadPeriods();
        }
      } catch (error) {
        console.error("Erro ao carregar dados iniciais:", error);
        setError("Não foi possível carregar os dados iniciais.");
      } finally {
        setLoading(false);
      }
    };
    
    loadInitialData();
  }, []);

  // Carregar períodos existentes
  const loadPeriods = async () => {
    try {
      if (!auth.currentUser) return;
      
      const periodsQuery = query(
        collection(db, "ofxFiles"),
        where("userId", "==", auth.currentUser.uid),
        orderBy("uploadDate", "desc")
      );
      
      const periodsSnapshot = await getDocs(periodsQuery);
      const periodsData = [];
      
      periodsSnapshot.forEach(doc => {
        const data = doc.data();
        periodsData.push({
          id: doc.id,
          fileName: data.fileName || "Arquivo sem nome",
          uploadDate: data.uploadDate?.toDate() || new Date(),
          period: data.period || "",
          periodLabel: data.periodLabel || "",
          month: data.month || "",
          year: data.year || "",
          filePath: data.filePath || null,
          transactionCount: data.transactionCount || 0
        });
      });
      
      setPeriods(periodsData);
    } catch (error) {
      console.error("Erro ao carregar períodos:", error);
      setError("Não foi possível carregar os períodos.");
    }
  };

  // Manipular mudança de arquivo
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && (selectedFile.name.endsWith('.ofx') || selectedFile.name.endsWith('.OFX'))) {
      setFile(selectedFile);
      
      // Tentar detectar mês/ano do nome do arquivo, por ex: extrato_202312.ofx
      const fileNameMatch = selectedFile.name.match(/(\d{4})(\d{2})/);
      if (fileNameMatch) {
        const [, yearStr, monthStr] = fileNameMatch;
        if (monthStr >= '01' && monthStr <= '12') {
          setMonth(monthStr);
        }
        if (yearStr >= '2000' && yearStr <= currentYear.toString()) {
          setYear(parseInt(yearStr));
        }
      }
    } else {
      setFile(null);
      setError("Por favor, selecione um arquivo OFX válido.");
    }
  };

  // Adicionar novo período
  const handleAddPeriod = async () => {
    if (!file) {
      setError("Por favor, selecione um arquivo OFX.");
      return;
    }
    
    if (!month) {
      setError("Por favor, selecione o mês do período.");
      return;
    }
    
    setError("");
    setUploading(true);
    setUploadProgress(10);
    
    try {
      // Verificar usuário atual
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Usuário não autenticado.");
      
      // Formatar o período (mês/ano)
      const period = `${year}-${month}`;
      const periodLabel = `${months.find(m => m.value === month)?.label} de ${year}`;
      
      // Verificar se o período já existe
      const existingPeriodQuery = query(
        collection(db, "ofxFiles"),
        where("userId", "==", currentUser.uid),
        where("period", "==", period)
      );
      
      const existingPeriodSnapshot = await getDocs(existingPeriodQuery);
      
      if (!existingPeriodSnapshot.empty) {
        setError(`O período ${periodLabel} já existe. Se deseja substituir, exclua o período existente primeiro.`);
        setUploading(false);
        return;
      }
      
      setUploadProgress(30);
      
      // Fazer upload do arquivo para o Firebase Storage
      const storageFilePath = `ofx/${currentUser.uid}/${period}/${file.name}`;
      const storageRef = ref(storage, storageFilePath);
      
      await uploadBytes(storageRef, file);
      setUploadProgress(60);
      
      // Obter URL de download para referência
      const downloadURL = await getDownloadURL(storageRef);
      
      setUploadProgress(80);
      
      // Salvar referência ao arquivo no Firestore
      await addDoc(collection(db, "ofxFiles"), {
        userId: currentUser.uid,
        fileName: file.name,
        uploadDate: serverTimestamp(),
        month,
        year,
        period,
        periodLabel,
        filePath: storageFilePath,
        fileURL: downloadURL
      });
      
      setUploadProgress(100);
      
      // Limpar formulário
      setFile(null);
      setMonth("");
      document.getElementById('ofx-file-input').value = '';
      
      // Recarregar períodos
      await loadPeriods();
      
      setSuccess(`Período ${periodLabel} adicionado com sucesso!`);
      setTimeout(() => setSuccess(""), 5000);
    } catch (error) {
      console.error("Erro ao adicionar período:", error);
      setError(`Erro ao adicionar período: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  // Estados para o modal de confirmação
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [periodToDelete, setPeriodToDelete] = useState(null);

  // Iniciar o processo de exclusão abrindo o modal
  const confirmDeletePeriod = (periodId, periodLabel, filePath) => {
    setPeriodToDelete({
      id: periodId,
      label: periodLabel,
      filePath: filePath
    });
    setShowConfirmModal(true);
  };

  // Cancelar a exclusão
  const cancelDelete = () => {
    setShowConfirmModal(false);
    setPeriodToDelete(null);
  };

  // Excluir período após confirmação
  const handleDeletePeriod = async () => {
    if (!periodToDelete) return;
    
    setLoading(true);
    setShowConfirmModal(false);
    
    try {
      // Excluir documento do Firestore
      await deleteDoc(doc(db, "ofxFiles", periodToDelete.id));
      
      // Excluir arquivo do Storage se houver caminho
      if (periodToDelete.filePath) {
        const storageRef = ref(storage, periodToDelete.filePath);
        await deleteObject(storageRef);
      }
      
      // Atualizar lista de períodos
      setPeriods(prevPeriods => prevPeriods.filter(p => p.id !== periodToDelete.id));
      
      setSuccess(`Período ${periodToDelete.label} excluído com sucesso!`);
      setTimeout(() => setSuccess(""), 5000);
    } catch (error) {
      console.error("Erro ao excluir período:", error);
      setError(`Erro ao excluir período: ${error.message}`);
    } finally {
      setLoading(false);
      setPeriodToDelete(null);
    }
  };

  // Formatar data
  const formatDate = (date) => {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };
  
  // Iniciar o download do arquivo OFX
  const handleDownloadFile = async (period) => {
    try {
      // Verificar se temos a informação do caminho do arquivo
      if (!period.filePath) {
        setError("Informação do arquivo não disponível para download.");
        return;
      }
      
      // Obter a URL de download atualizada
      const storageRef = ref(storage, period.filePath);
      const downloadURL = await getDownloadURL(storageRef);
      
      // Criar um link temporário para download
      const link = document.createElement('a');
      link.href = downloadURL;
      link.download = period.fileName || 'arquivo.ofx';
      
      // Adicionar o link ao documento, clicar e remover
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Erro ao baixar arquivo:", error);
      setError(`Erro ao baixar arquivo: ${error.message}`);
    }
  };

  return (
    <MainLayout userName={user?.displayName || "Usuário"}>
      <div className="period-manager-container">
        <div className="period-manager-header">
          <h1>Gerenciador de Períodos</h1>
        </div>
        
        {error && (
          <div className="error-message">
            <button className="close-button" onClick={() => setError("")}>×</button>
            {error}
          </div>
        )}
        
        {success && (
          <div className="success-message">
            <button className="close-button" onClick={() => setSuccess("")}>×</button>
            {success}
          </div>
        )}
        
        <div className="period-manager-content">
          {/* Formulário para adicionar novo período */}
          <div className="add-period-card">
            <h2>Adicionar Novo Período</h2>
            
            <div className="add-period-form">
              <div className="form-group">
                <label htmlFor="ofx-file-input">Arquivo OFX</label>
                <div className="file-input-container">
                  <input
                    type="file"
                    id="ofx-file-input"
                    accept=".ofx,.OFX"
                    onChange={handleFileChange}
                    disabled={uploading}
                    className="file-input"
                  />
                  <label htmlFor="ofx-file-input" className="file-label">
                    {file ? file.name : "Escolher arquivo OFX"}
                  </label>
                </div>
              </div>
              
              <div className="period-selection">
                <div className="form-group">
                  <label htmlFor="month-select">Mês</label>
                  <select 
                    id="month-select"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    disabled={uploading}
                    className="period-select"
                  >
                    <option value="">Selecione o mês</option>
                    {months.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                
                <div className="form-group">
                  <label htmlFor="year-select">Ano</label>
                  <select
                    id="year-select"
                    value={year}
                    onChange={(e) => setYear(parseInt(e.target.value))}
                    disabled={uploading}
                    className="period-select"
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <button 
                className="add-period-button"
                onClick={handleAddPeriod}
                disabled={!file || !month || uploading}
              >
                {uploading ? "Adicionando..." : "Adicionar Período"}
              </button>
              
              {uploading && (
                <div className="upload-progress">
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                  <div className="progress-text">{uploadProgress}% Concluído</div>
                </div>
              )}
            </div>
          </div>
          
          {/* Lista de períodos existentes */}
          <div className="periods-list-card">
            <h2>Períodos Existentes</h2>
            
            {loading ? (
              <div className="loading-container">
                <div className="loading-spinner"></div>
                <p>Carregando períodos...</p>
              </div>
            ) : periods.length === 0 ? (
              <div className="no-periods">
                <p>Nenhum período encontrado. Adicione um novo período utilizando o formulário acima.</p>
              </div>
            ) : (
              <div className="periods-list">
                <table className="periods-table">
                  <thead>
                    <tr>
                      <th>Período</th>
                      <th>Arquivo</th>
                      <th>Data de Upload</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((period) => (
                      <tr key={period.id}>
                        <td>{period.periodLabel}</td>
                        <td className="file-name-cell">{period.fileName}</td>
                        <td>{formatDate(period.uploadDate)}</td>
                        <td className="action-buttons">
                          <button 
                            className="download-button"
                            onClick={() => handleDownloadFile(period)}
                            disabled={loading}
                          >
                            Baixar
                          </button>
                          <button 
                            className="delete-button"
                            onClick={() => confirmDeletePeriod(period.id, period.periodLabel, period.filePath)}
                            disabled={loading}
                          >
                            Excluir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Modal de confirmação de exclusão */}
      {showConfirmModal && (
        <div className="confirm-modal-overlay">
          <div className="confirm-modal">
            <div className="confirm-modal-header">
              <h3>Confirmar Exclusão</h3>
            </div>
            <div className="confirm-modal-content">
              <p>Tem certeza que deseja excluir o período <strong>{periodToDelete?.label}</strong>?</p>
              <p className="warning-text">Esta ação não pode ser desfeita.</p>
            </div>
            <div className="confirm-modal-footer">
              <button 
                className="cancel-button"
                onClick={cancelDelete}
              >
                Cancelar
              </button>
              <button 
                className="confirm-button"
                onClick={handleDeletePeriod}
              >
                Confirmar Exclusão
              </button>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
};

export default PeriodManager;