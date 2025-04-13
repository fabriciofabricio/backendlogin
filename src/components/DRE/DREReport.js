// src/components/DRE/DREReport.js
import React, { useState, useEffect } from "react";
import { auth, db, storage } from "../../firebase/config";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  getDoc
} from "firebase/firestore";
import { ref, getBlob } from "firebase/storage";
import { parseOFXContent } from "../../utils/OFXParser";
import MainLayout from "../Layout/MainLayout";
import "./DRE.css";

const DREReport = () => {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [dreData, setDreData] = useState({});
  const [unmappedTransactions, setUnmappedTransactions] = useState([]);
  const [error, setError] = useState("");
  const [categoryOrder, setCategoryOrder] = useState({});
  const [categoryMappings, setCategoryMappings] = useState({});
  const [nonCategorizedExpanded, setNonCategorizedExpanded] = useState(false);

  // Função para alternar a visibilidade das transações não categorizadas
  const toggleNonCategorizedSection = () => {
    setNonCategorizedExpanded(!nonCategorizedExpanded);
  };

  // Carregar usuário e períodos disponíveis
  useEffect(() => {
    const loadUserAndPeriods = async () => {
      try {
        setLoading(true);
        
        if (auth.currentUser) {
          setUser(auth.currentUser);
          
          // Buscar períodos únicos dos arquivos OFX
          const periodsQuery = query(
            collection(db, "ofxFiles"),
            where("userId", "==", auth.currentUser.uid)
          );
          
          const periodsSnapshot = await getDocs(periodsQuery);
          const uniquePeriods = [];
          const periodsSet = new Set();
          
          periodsSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.period && !periodsSet.has(data.period)) {
              periodsSet.add(data.period);
              uniquePeriods.push({
                value: data.period,
                label: data.periodLabel || data.period
              });
            }
          });
          
          // Ordenar os períodos manualmente
          uniquePeriods.sort((a, b) => b.value.localeCompare(a.value));
          setPeriods(uniquePeriods);
          
          // Verificar se existe um período salvo no localStorage
          let savedPeriod = localStorage.getItem('selectedPeriod');
          let periodToUse;
          
          if (savedPeriod && uniquePeriods.find(p => p.value === savedPeriod)) {
            // Se existir um período salvo e ele estiver disponível, usar ele
            periodToUse = savedPeriod;
          } else if (uniquePeriods.length > 0) {
            // Caso contrário, usar o período mais recente
            periodToUse = uniquePeriods[0].value;
            // Salvar no localStorage
            localStorage.setItem('selectedPeriod', periodToUse);
          }
          
          if (periodToUse) {
            setSelectedPeriod(periodToUse);
          }
          
          // Carregar a ordem das categorias
          const userCategoriesDoc = await getDoc(doc(db, "userCategories", auth.currentUser.uid));
          if (userCategoriesDoc.exists() && userCategoriesDoc.data().categoryOrder) {
            setCategoryOrder(userCategoriesDoc.data().categoryOrder);
          }
          
          // Carregar mapeamentos de categorias
          await loadCategoryMappings(auth.currentUser.uid);
        }
      } catch (error) {
        console.error("Erro ao carregar períodos:", error);
        setError("Não foi possível carregar os períodos disponíveis.");
      } finally {
        setLoading(false);
      }
    };
    
    loadUserAndPeriods();
  }, []);

  // Função para carregar os mapeamentos de categorias
  const loadCategoryMappings = async (userId) => {
    try {
      const mappingsDoc = await getDoc(doc(db, "categoryMappings", userId));
      
      if (mappingsDoc.exists() && mappingsDoc.data().mappings) {
        setCategoryMappings(mappingsDoc.data().mappings);
        return mappingsDoc.data().mappings;
      }
      
      return {};
    } catch (error) {
      console.error("Erro ao carregar mapeamentos de categorias:", error);
      return {};
    }
  };

  // Reset não categorizado expandido quando mudar de período
  useEffect(() => {
    setNonCategorizedExpanded(false);
  }, [selectedPeriod]);

  // Carregar dados do DRE quando o período selecionado mudar
  useEffect(() => {
    if (selectedPeriod && user) {
      loadDREData(selectedPeriod);
    }
  }, [selectedPeriod, user, categoryMappings]);

  // Função para carregar os dados do DRE
  const loadDREData = async (period) => {
    try {
      setLoading(true);
      
      const dreStructure = {};
      const unmappedItems = [];
      
      const mainCategories = [
        "RECEITA",
        "(-) DEDUÇÕES DA RECEITA",
        "(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS",
        "(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)",
        "(-) DESPESAS OPERACIONAIS",
        "(-) DESPESAS COM SÓCIOS",
        "(-) INVESTIMENTOS",
        "NÃO CATEGORIZADO"
      ];
      
      mainCategories.forEach(category => {
        dreStructure[category] = {
          total: 0,
          items: {}
        };
      });

      // Identificar mapeamentos específicos por ID de transação
      const specificMappings = {};
      
      // Identificamos todos os mapeamentos específicos (para transações únicas)
      Object.entries(categoryMappings).forEach(([key, mapping]) => {
        if (mapping.isSpecificMapping && mapping.transactionId) {
          specificMappings[mapping.transactionId] = mapping;
        }
      });
      
      // PARTE 1: Processar arquivos OFX
      const ofxFilesQuery = query(
        collection(db, "ofxFiles"),
        where("userId", "==", user.uid),
        where("period", "==", period)
      );
      
      const ofxFilesSnapshot = await getDocs(ofxFilesQuery);
      
      for (const fileDoc of ofxFilesSnapshot.docs) {
        const fileData = fileDoc.data();
        
        if (fileData.filePath) {
          try {
            const storageRef = ref(storage, fileData.filePath);
            const blob = await getBlob(storageRef);
            const fileContent = await blob.text();
            const parseResult = parseOFXContent(fileContent);
            const transactions = parseResult.transactions;
            
            transactions.forEach(transaction => {
              const normalizedDescription = transaction.description.trim().toLowerCase();
              let mainCategory, subCategory, mapping;
              let categorized = false;
              
              // Primeiro, verificar se existe um mapeamento específico para esta transação
              if (specificMappings[transaction.id]) {
                mapping = specificMappings[transaction.id];
                mainCategory = mapping.groupName;
                subCategory = mapping.categoryName;
                categorized = true;
              }
              // Se não existir mapeamento específico, verificar mapeamento normal
              else if (categoryMappings[normalizedDescription]) {
                mapping = categoryMappings[normalizedDescription];
                if (!mapping.isSpecificMapping) { // Garantir que não é um mapeamento específico para outra transação
                  mainCategory = mapping.groupName;
                  subCategory = mapping.categoryName;
                  categorized = true;
                }
              }
              
              if (categorized && dreStructure[mainCategory]) {
                if (!dreStructure[mainCategory].items[subCategory]) {
                  dreStructure[mainCategory].items[subCategory] = 0;
                }
                dreStructure[mainCategory].items[subCategory] += transaction.amount;
                dreStructure[mainCategory].total += transaction.amount;
              } else {
                unmappedItems.push({
                  id: transaction.id,
                  ...transaction,
                  fileId: fileDoc.id,
                  period: period
                });
                
                const description = transaction.description || "Transação sem descrição";
                if (!dreStructure["NÃO CATEGORIZADO"].items[description]) {
                  dreStructure["NÃO CATEGORIZADO"].items[description] = 0;
                }
                dreStructure["NÃO CATEGORIZADO"].items[description] += transaction.amount;
                dreStructure["NÃO CATEGORIZADO"].total += transaction.amount;
              }
            });
          } catch (error) {
            console.error(`Erro ao processar arquivo OFX ${fileData.fileName}:`, error);
          }
        }
      }
      
      // PARTE 2: Processar entradas manuais de dinheiro
      // Consultar entradas de dinheiro para o período selecionado
      const cashEntriesQuery = query(
        collection(db, "cashEntries"),
        where("userId", "==", user.uid),
        where("period", "==", period)
      );
      
      const cashEntriesSnapshot = await getDocs(cashEntriesQuery);
      
      // Processar cada entrada manual e adicionar à estrutura DRE
      cashEntriesSnapshot.forEach(doc => {
        const entry = doc.data();
        
        // Verificar se a entrada tem categoria e valor
        if (entry.categoryPath && typeof entry.amount === 'number') {
          const pathParts = entry.categoryPath.split('.');
          
          if (pathParts.length >= 2) {
            const mainCategory = pathParts[0];
            const subCategory = entry.category || pathParts[1];
            
            // Verificar se a categoria principal existe na estrutura DRE
            if (dreStructure[mainCategory]) {
              // Adicionar à categoria principal
              if (!dreStructure[mainCategory].items[subCategory]) {
                dreStructure[mainCategory].items[subCategory] = 0;
              }
              
              dreStructure[mainCategory].items[subCategory] += entry.amount;
              dreStructure[mainCategory].total += entry.amount;
              
              console.log(`Entrada manual adicionada: ${formatCurrency(entry.amount)} em ${mainCategory}.${subCategory}`);
            }
          }
        }
      });
      
      const results = calculateDREResults(dreStructure);
      
      setDreData({
        categories: dreStructure,
        results: results
      });
      
      setUnmappedTransactions(unmappedItems);
    } catch (error) {
      console.error("Erro ao carregar dados do DRE:", error);
      setError("Não foi possível carregar os dados do DRE para o período selecionado.");
    } finally {
      setLoading(false);
    }
  };

  // Função para calcular os resultados do DRE
  const calculateDREResults = (dreStructure) => {
    const results = {};
    
    const getAbsValueIfNegative = (value) => {
      return value < 0 ? Math.abs(value) : value;
    };
    
    results.receitaBruta = dreStructure["RECEITA"].total || 0;
    const deducoes = dreStructure["(-) DEDUÇÕES DA RECEITA"].total || 0;
    results.receitaLiquida = results.receitaBruta - getAbsValueIfNegative(deducoes);
    
    const custos = dreStructure["(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)"].total || 0;
    results.lucroBruto = results.receitaLiquida - getAbsValueIfNegative(custos);
    
    const despesasOperacionais = dreStructure["(-) DESPESAS OPERACIONAIS"].total || 0;
    const outrasReceitas = dreStructure["(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS"].total || 0;
    results.resultadoOperacional = results.lucroBruto - getAbsValueIfNegative(despesasOperacionais) + getAbsValueIfNegative(outrasReceitas);
    
    const despesasSocios = dreStructure["(-) DESPESAS COM SÓCIOS"].total || 0;
    results.resultadoAntesIR = results.resultadoOperacional - getAbsValueIfNegative(despesasSocios);
    
    const investimentos = dreStructure["(-) INVESTIMENTOS"].total || 0;
    const naoCategorizado = dreStructure["NÃO CATEGORIZADO"].total || 0;
    results.resultadoLiquido = results.resultadoAntesIR - getAbsValueIfNegative(investimentos) + naoCategorizado;
    
    return results;
  };

  // Função para formatar valores monetários
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  // Função para obter a classe CSS baseada no valor
  const getValueClass = (value, isNegativeNormal = false) => {
    if (value === 0) return "value-zero";
    if (isNegativeNormal) {
      return value < 0 ? "value-negative" : "value-positive";
    } else {
      return value < 0 ? "value-positive" : "value-negative";
    }
  };

  // Ordenar categorias principais
  const sortedMainCategories = Object.keys(dreData.categories || {}).sort((a, b) => {
    return (categoryOrder[a] || 999) - (categoryOrder[b] || 999);
  });

  if (loading && !selectedPeriod) {
    return (
      <MainLayout>
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Carregando períodos disponíveis...</p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout userName={user?.displayName || "Usuário"}>
      <div className="dre-container">
        <div className="dre-header">
          <h1>Demonstração do Resultado do Exercício (DRE)</h1>
          
          <div className="period-selector">
            <label htmlFor="period-select">Período:</label>
            <select
              id="period-select"
              value={selectedPeriod}
              onChange={(e) => {
                const period = e.target.value;
                setSelectedPeriod(period);
                // Salvar o período selecionado no localStorage
                localStorage.setItem('selectedPeriod', period);
              }}
              disabled={loading}
            >
              {periods.length === 0 ? (
                <option value="">Nenhum período disponível</option>
              ) : (
                periods.map((period) => (
                  <option key={period.value} value={period.value}>
                    {period.label}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
        
        {error && (
          <div className="error-message">
            {error}
          </div>
        )}
        
        {unmappedTransactions.length > 0 && (
          <div className="warning-message">
            <p>
              <strong>Atenção:</strong> Existem {unmappedTransactions.length} transações não 
              categorizadas neste período. Para uma DRE mais precisa, categorize estas transações na página de transações.
            </p>
          </div>
        )}
        
        {loading ? (
          <div className="loading-data">
            <div className="loading-spinner"></div>
            <p>Carregando dados do DRE...</p>
          </div>
        ) : (
          <div className="dre-content">
            <div className="dre-summary">
              <h2>Resumo Financeiro</h2>
              <div className="summary-cards">
                <div className="summary-card">
                  <h3>Receita Bruta</h3>
                  <div className={`summary-value ${getValueClass(dreData.results?.receitaBruta || 0, true)}`}>
                    {formatCurrency(dreData.results?.receitaBruta || 0)}
                  </div>
                </div>
                
                <div className="summary-card">
                  <h3>Lucro Bruto</h3>
                  <div className={`summary-value ${getValueClass(dreData.results?.lucroBruto || 0, true)}`}>
                    {formatCurrency(dreData.results?.lucroBruto || 0)}
                  </div>
                </div>
                
                <div className="summary-card">
                  <h3>Resultado Líquido</h3>
                  <div className={`summary-value ${getValueClass(dreData.results?.resultadoLiquido || 0, true)}`}>
                    {formatCurrency(dreData.results?.resultadoLiquido || 0)}
                  </div>
                </div>
              </div>
            </div>
            
            <div className="dre-table-container">
              <table className="dre-table">
                <thead>
                  <tr>
                    <th className="category-column">Categoria</th>
                    <th className="value-column">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="main-category">
                    <td>1. RECEITA</td>
                    <td className={getValueClass(dreData.categories?.["RECEITA"]?.total || 0, true)}>
                      {formatCurrency(dreData.categories?.["RECEITA"]?.total || 0)}
                    </td>
                  </tr>
                  {Object.entries(dreData.categories?.["RECEITA"]?.items || {}).map(([subCategory, value], index) => (
                    <tr key={index} className="sub-category">
                      <td>{subCategory}</td>
                      <td className={getValueClass(value, true)}>
                        {formatCurrency(value)}
                      </td>
                    </tr>
                  ))}
                  
                  <tr className="main-category">
                    <td>2. (-) DEDUÇÕES DA RECEITA</td>
                    <td className={getValueClass(dreData.categories?.["(-) DEDUÇÕES DA RECEITA"]?.total || 0)}>
                      {formatCurrency(dreData.categories?.["(-) DEDUÇÕES DA RECEITA"]?.total || 0)}
                    </td>
                  </tr>
                  {Object.entries(dreData.categories?.["(-) DEDUÇÕES DA RECEITA"]?.items || {}).map(([subCategory, value], index) => (
                    <tr key={index} className="sub-category">
                      <td>{subCategory}</td>
                      <td className={getValueClass(value)}>
                        {formatCurrency(value)}
                      </td>
                    </tr>
                  ))}
                  
                  <tr className="result-row">
                    <td>3. (=) RECEITA LÍQUIDA</td>
                    <td className={getValueClass(dreData.results?.receitaLiquida || 0, true)}>
                      {formatCurrency(dreData.results?.receitaLiquida || 0)}
                    </td>
                  </tr>
                  
                  <tr className="main-category">
                    <td>4. (+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS</td>
                    <td className={getValueClass(dreData.categories?.["(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS"]?.total || 0, true)}>
                      {formatCurrency(dreData.categories?.["(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS"]?.total || 0)}
                    </td>
                  </tr>
                  {Object.entries(dreData.categories?.["(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS"]?.items || {}).map(([subCategory, value], index) => (
                    <tr key={index} className="sub-category">
                      <td>{subCategory}</td>
                      <td className={getValueClass(value, true)}>
                        {formatCurrency(value)}
                      </td>
                    </tr>
                  ))}
                  
                  <tr className="main-category">
                    <td>5. (-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)</td>
                    <td className={getValueClass(dreData.categories?.["(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)"]?.total || 0)}>
                      {formatCurrency(dreData.categories?.["(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)"]?.total || 0)}
                    </td>
                  </tr>
                  {Object.entries(dreData.categories?.["(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)"]?.items || {}).map(([subCategory, value], index) => (
                    <tr key={index} className="sub-category">
                      <td>{subCategory}</td>
                      <td className={getValueClass(value)}>
                        {formatCurrency(value)}
                      </td>
                    </tr>
                  ))}
                  
                  <tr className="result-row">
                    <td>6. (=) LUCRO BRUTO</td>
                    <td className={getValueClass(dreData.results?.lucroBruto || 0, true)}>
                      {formatCurrency(dreData.results?.lucroBruto || 0)}
                    </td>
                  </tr>
                  
                  <tr className="main-category">
                    <td>7. (-) DESPESAS OPERACIONAIS</td>
                    <td className={getValueClass(dreData.categories?.["(-) DESPESAS OPERACIONAIS"]?.total || 0)}>
                      {formatCurrency(dreData.categories?.["(-) DESPESAS OPERACIONAIS"]?.total || 0)}
                    </td>
                  </tr>
                  {Object.entries(dreData.categories?.["(-) DESPESAS OPERACIONAIS"]?.items || {}).map(([subCategory, value], index) => (
                    <tr key={index} className="sub-category">
                      <td>{subCategory}</td>
                      <td className={getValueClass(value)}>
                        {formatCurrency(value)}
                      </td>
                    </tr>
                  ))}
                  
                  <tr className="result-row">
                    <td>8. (=) RESULTADO OPERACIONAL</td>
                    <td className={getValueClass(dreData.results?.resultadoOperacional || 0, true)}>
                      {formatCurrency(dreData.results?.resultadoOperacional || 0)}
                    </td>
                  </tr>
                  
                  <tr className="main-category">
                    <td>9. (-) DESPESAS COM SÓCIOS</td>
                    <td className={getValueClass(dreData.categories?.["(-) DESPESAS COM SÓCIOS"]?.total || 0)}>
                      {formatCurrency(dreData.categories?.["(-) DESPESAS COM SÓCIOS"]?.total || 0)}
                    </td>
                  </tr>
                  {Object.entries(dreData.categories?.["(-) DESPESAS COM SÓCIOS"]?.items || {}).map(([subCategory, value], index) => (
                    <tr key={index} className="sub-category">
                      <td>{subCategory}</td>
                      <td className={getValueClass(value)}>
                        {formatCurrency(value)}
                      </td>
                    </tr>
                  ))}
                  
                  <tr className="result-row">
                    <td>10. (=) RESULTADO ANTES DO IR</td>
                    <td className={getValueClass(dreData.results?.resultadoAntesIR || 0, true)}>
                      {formatCurrency(dreData.results?.resultadoAntesIR || 0)}
                    </td>
                  </tr>
                  
                  <tr className="main-category">
                    <td>11. (-) INVESTIMENTOS</td>
                    <td className={getValueClass(dreData.categories?.["(-) INVESTIMENTOS"]?.total || 0)}>
                      {formatCurrency(dreData.categories?.["(-) INVESTIMENTOS"]?.total || 0)}
                    </td>
                  </tr>
                  {Object.entries(dreData.categories?.["(-) INVESTIMENTOS"]?.items || {}).map(([subCategory, value], index) => (
                    <tr key={index} className="sub-category">
                      <td>{subCategory}</td>
                      <td className={getValueClass(value)}>
                        {formatCurrency(value)}
                      </td>
                    </tr>
                  ))}
                  
                  <tr className="final-result-row">
                    <td>12. (=) RESULTADO LÍQUIDO</td>
                    <td className={getValueClass(dreData.results?.resultadoLiquido || 0, true)}>
                      {formatCurrency(dreData.results?.resultadoLiquido || 0)}
                    </td>
                  </tr>
                  
                  {Object.keys(dreData.categories?.["NÃO CATEGORIZADO"]?.items || {}).length > 0 && (
                    <>
                      <tr 
                        className="main-category non-categorized-header" 
                        onClick={toggleNonCategorizedSection}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          Transações não categorizadas 
                          <span className="toggle-icon">{nonCategorizedExpanded ? ' ▼' : ' ►'}</span>
                        </td>
                        <td className={getValueClass(dreData.categories?.["NÃO CATEGORIZADO"]?.total || 0, true)}>
                          {formatCurrency(dreData.categories?.["NÃO CATEGORIZADO"]?.total || 0)}
                        </td>
                      </tr>
                      {nonCategorizedExpanded && Object.entries(dreData.categories?.["NÃO CATEGORIZADO"]?.items || {}).map(([description, value], index) => (
                        <tr key={index} className="sub-category non-categorized-item">
                          <td>{description.length > 50 ? description.substring(0, 50) + '...' : description}</td>
                          <td className={getValueClass(value, true)}>
                            {formatCurrency(value)}
                          </td>
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>
            
            <div className="dre-actions">
              <button className="print-button" onClick={() => window.print()}>
                Imprimir DRE
              </button>
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  );
};

export default DREReport;