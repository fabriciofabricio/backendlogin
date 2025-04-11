// src/components/Transactions/FileUpload.js
import React, { useState } from "react";
import { auth, db, storage } from "../../firebase/config";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { parseOFXFile } from "../../utils/OFXParser";
import "./Transactions.css";

const FileUpload = ({ onTransactionsLoaded, onError }) => {
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [month, setMonth] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [bankInfo, setBankInfo] = useState(null);
  
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

  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && (selectedFile.name.endsWith('.ofx') || selectedFile.name.endsWith('.OFX'))) {
      setFile(selectedFile);
      
      try {
        // Preview do arquivo para extrair informações do banco
        const result = await parseOFXFile(selectedFile);
        setBankInfo(result.bankInfo);
        
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
      } catch (error) {
        console.error("Erro ao analisar o arquivo:", error);
        // Ainda permitimos o upload mesmo que haja erro na pré-análise
      }
    } else {
      setFile(null);
      setBankInfo(null);
      onError("Por favor, selecione um arquivo OFX válido.");
    }
  };

  const handleUpload = async () => {
    if (!file) {
      onError("Por favor, selecione um arquivo OFX válido.");
      return;
    }
    
    if (!month) {
      onError("Por favor, selecione o mês do extrato.");
      return;
    }

    try {
      setUploading(true);
      setProgress(20);

      // Verificar usuário atual
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Usuário não autenticado.");

      // Formatar o período (mês/ano)
      const period = `${year}-${month}`;
      const periodLabel = `${months.find(m => m.value === month)?.label} de ${year}`;
      
      // 1. Fazer upload do arquivo para o Firebase Storage
      const storageFilePath = `ofx/${currentUser.uid}/${period}/${file.name}`;
      const storageRef = ref(storage, storageFilePath);
      
      await uploadBytes(storageRef, file);
      setProgress(50);
      
      // Obter URL de download para referência
      const downloadURL = await getDownloadURL(storageRef);
      
      // 2. Parse the OFX file to extract transactions (apenas para exibição imediata)
      const parseResult = await parseOFXFile(file);
      const { transactions, bankInfo } = parseResult;
      setProgress(80);
      
      // 3. Salvar referência ao arquivo no Firestore
      const fileRef = await addDoc(collection(db, "ofxFiles"), {
        userId: currentUser.uid,
        fileName: file.name,
        uploadDate: serverTimestamp(),
        transactionCount: transactions.length,
        month,
        year,
        period,
        periodLabel,
        filePath: storageFilePath,
        fileURL: downloadURL,
        bankInfo: bankInfo || null // Salvar informações do banco
      });

      setProgress(100);

      // 4. Associar o período às transações
      const transactionsWithPeriod = transactions.map(transaction => ({
        ...transaction,
        period,
        periodLabel,
        month,
        year: year.toString()
      }));

      // 5. Passar as transações analisadas para o componente pai
      onTransactionsLoaded(transactionsWithPeriod, fileRef.id);

      // Reset the form
      setFile(null);
      setBankInfo(null);
      document.getElementById('ofx-file-input').value = '';
    } catch (error) {
      console.error("Error processing OFX file:", error);
      onError(`Erro ao processar o arquivo: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="file-upload-container">
      <h3>Importar Extrato OFX</h3>
      
      <div className="file-upload-form">
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
      
      {bankInfo && bankInfo.org && (
        <div className="bank-info-container">
          <div className="bank-info">
            <span className="bank-label">Banco identificado:</span>
            <span className="bank-name">{bankInfo.org}</span>
          </div>
        </div>
      )}
      
      <div className="period-selection">
        <div className="period-field">
          <label htmlFor="month-select">Mês do extrato:</label>
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
        
        <div className="period-field">
          <label htmlFor="year-select">Ano do extrato:</label>
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
      
      <div className="upload-button-container">
        <button 
          onClick={handleUpload} 
          disabled={!file || !month || uploading}
          className="upload-button"
        >
          {uploading ? "Processando..." : "Importar Transações"}
        </button>
      </div>
      
      {uploading && (
        <div className="upload-progress">
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          <div className="progress-text">{progress}% Concluído</div>
        </div>
      )}
      
      <div className="upload-instructions">
        <p>Selecione um arquivo OFX do seu banco e especifique o mês e ano do extrato.</p>
        <p>As transações serão analisadas e categorizadas automaticamente quando possível.</p>
      </div>
    </div>
  );
};

export default FileUpload;