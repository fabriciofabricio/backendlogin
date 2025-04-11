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
import { useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
  
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
          // Removendo o orderBy para evitar exigência de índice composto
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
          
          // Ordenar os períodos manualmente após obter os dados
          uniquePeriods.sort((a, b) => b.value.localeCompare(a.value));
          setPeriods(uniquePeriods);
          
          // Selecionar automaticamente o período mais recente
          if (uniquePeriods.length > 0) {
            setSelectedPeriod(uniquePeriods[0].value);
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

  // Função para carregar os dados do DRE para o período selecionado
  const loadDREData = async (period) => {
    try {
      setLoading(true);
      
      // Estrutura para organizar as categorias e valores do DRE
      const dreStructure = {};
      const unmappedItems = [];
      
      // Inicializar a estrutura do DRE com as categorias principais
      const mainCategories = [
        "RECEITA",
        "(-) DEDUÇÕES DA RECEITA",
        "(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS",
        "(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)",
        "(-) DESPESAS OPERACIONAIS",
        "(-) DESPESAS COM SÓCIOS",
        "(-) INVESTIMENTOS",
        "NÃO CATEGORIZADO" // Categoria para transações não categorizadas
      ];
      
      mainCategories.forEach(category => {
        dreStructure[category] = {
          total: 0,
          items: {}
        };
      });
      
      // Buscar arquivos OFX do período para processar as transações
      const ofxFilesQuery = query(
        collection(db, "ofxFiles"),
        where("userId", "==", user.uid),
        where("period", "==", period)
      );
      
      const ofxFilesSnapshot = await getDocs(ofxFilesQuery);
      
      // Processar cada arquivo OFX
      for (const fileDoc of ofxFilesSnapshot.docs) {
        const fileData = fileDoc.data();
        
        // Verificar se o arquivo tem o caminho para o Storage
        if (fileData.filePath) {
          try {
            // Buscar o arquivo do Firebase Storage
            const storageRef = ref(storage, fileData.filePath);
            const blob = await getBlob(storageRef);
            
            // Converter o Blob para texto
            const fileContent = await blob.text();
            
            // Processar o conteúdo do arquivo OFX
            const parseResult = parseOFXContent(fileContent);
            const transactions = parseResult.transactions;
            
            // Processar cada transação do OFX
            transactions.forEach(transaction => {
              // Normalizar a descrição para buscar no mapeamento
              const normalizedDescription = transaction.description.trim().toLowerCase();
              
              // Verificar se existe um mapeamento para esta descrição
              if (categoryMappings[normalizedDescription]) {
                const mapping = categoryMappings[normalizedDescription];
                const mainCategory = mapping.groupName;
                const subCategory = mapping.categoryName;
                
                // Verificar se a categoria principal existe na estrutura do DRE
                if (dreStructure[mainCategory]) {
                  // Inicializar subcategoria se não existir
                  if (!dreStructure[mainCategory].items[subCategory]) {
                    dreStructure[mainCategory].items[subCategory] = 0;
                  }
                  
                  // Adicionar valor da transação à subcategoria
                  dreStructure[mainCategory].items[subCategory] += transaction.amount;
                  
                  // Atualizar total da categoria principal
                  dreStructure[mainCategory].total += transaction.amount;
                }
              } else {
                // Adicionar à lista de transações não mapeadas
                unmappedItems.push({
                  id: transaction.id,
                  ...transaction,
                  fileId: fileDoc.id,
                  period: period
                });
                
                // Adicionar à categoria "NÃO CATEGORIZADO"
                const description = transaction.description || "Transação sem descrição";
                
                // Inicializar a descrição como subcategoria se não existir
                if (!dreStructure["NÃO CATEGORIZADO"].items[description]) {
                  dreStructure["NÃO CATEGORIZADO"].items[description] = 0;
                }
                
                // Adicionar valor da transação
                dreStructure["NÃO CATEGORIZADO"].items[description] += transaction.amount;
                
                // Atualizar total da categoria de não categorizados
                dreStructure["NÃO CATEGORIZADO"].total += transaction.amount;
              }
            });
          } catch (error) {
            console.error(`Erro ao processar arquivo OFX ${fileData.fileName}:`, error);
          }
        }
      }
      
      // Calcular resultados do DRE
      const results = calculateDREResults(dreStructure);
      
      // Atualizar estado com os dados do DRE e transações não mapeadas
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

  // Função corrigida para calcular os resultados do DRE
const calculateDREResults = (dreStructure) => {
  const results = {};
  
  // Função utilitária para tratar valores de forma consistente
  // Garantindo que categorias de despesa sejam valores absolutos (para subtração)
  const getAbsValueIfNegative = (value) => {
    // Se o valor armazenado for negativo, usamos o valor absoluto para subtração
    return value < 0 ? Math.abs(value) : value;
  };
  
  // 1. Receita Bruta (Receita Total)
  results.receitaBruta = dreStructure["RECEITA"].total || 0;
  
  // 2. Receita Líquida (Receita Bruta - Deduções)
  const deducoes = dreStructure["(-) DEDUÇÕES DA RECEITA"].total || 0;
  results.receitaLiquida = results.receitaBruta - getAbsValueIfNegative(deducoes);
  
  // 3. Lucro Bruto (Receita Líquida - Custos)
  const custos = dreStructure["(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)"].total || 0;
  results.lucroBruto = results.receitaLiquida - getAbsValueIfNegative(custos);
  
  // 4. Resultado Operacional (Lucro Bruto - Despesas Operacionais + Outras Receitas)
  const despesasOperacionais = dreStructure["(-) DESPESAS OPERACIONAIS"].total || 0;
  const outrasReceitas = dreStructure["(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS"].total || 0;
  
  // Subtrair despesas operacionais (garantindo que sejam tratadas como valor a subtrair)
  // e somar outras receitas
  results.resultadoOperacional = results.lucroBruto - getAbsValueIfNegative(despesasOperacionais) + getAbsValueIfNegative(outrasReceitas);
  
  // 5. Resultado Antes do IR (Resultado Operacional - Despesas com Sócios)
  const despesasSocios = dreStructure["(-) DESPESAS COM SÓCIOS"].total || 0;
  results.resultadoAntesIR = results.resultadoOperacional - getAbsValueIfNegative(despesasSocios);
  
  // 6. Resultado Líquido (Resultado Antes do IR - Investimentos + Não Categorizados)
  const investimentos = dreStructure["(-) INVESTIMENTOS"].total || 0;
  const naoCategorizado = dreStructure["NÃO CATEGORIZADO"].total || 0;
  
  // Subtrair investimentos e adicionar ou subtrair não categorizados conforme o sinal
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

  // Ordenar categorias principais conforme a estrutura do DRE
  const sortedMainCategories = Object.keys(dreData.categories || {}).sort((a, b) => {
    return (categoryOrder[a] || 999) - (categoryOrder[b] || 999);
  });

  if (loading && !selectedPeriod) {
    return (
      <div className="dre-container loading">
        <div className="loading-spinner"></div>
        <p>Carregando períodos disponíveis...</p>
      </div>
    );
  }

  return (
    <div className="dre-container">
      <div className="dre-header">
        <h1>Demonstração do Resultado do Exercício (DRE)</h1>
        
        <div className="period-selector">
          <label htmlFor="period-select">Período:</label>
          <select
            id="period-select"
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
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
                {/* Receita Bruta */}
                <tr className="main-category">
                  <td>1. RECEITA</td>
                  <td className={getValueClass(dreData.categories?.["RECEITA"]?.total || 0, true)}>
                    {formatCurrency(dreData.categories?.["RECEITA"]?.total || 0)}
                  </td>
                </tr>
                
                {/* Detalhamento da Receita */}
                {Object.entries(dreData.categories?.["RECEITA"]?.items || {}).map(([subCategory, value], index) => (
                  <tr key={index} className="sub-category">
                    <td>{subCategory}</td>
                    <td className={getValueClass(value, true)}>
                      {formatCurrency(value)}
                    </td>
                  </tr>
                ))}
                
                {/* Deduções */}
                <tr className="main-category">
                  <td>2. (-) DEDUÇÕES DA RECEITA</td>
                  <td className={getValueClass(dreData.categories?.["(-) DEDUÇÕES DA RECEITA"]?.total || 0)}>
                    {formatCurrency(dreData.categories?.["(-) DEDUÇÕES DA RECEITA"]?.total || 0)}
                  </td>
                </tr>
                
                {/* Detalhamento das Deduções */}
                {Object.entries(dreData.categories?.["(-) DEDUÇÕES DA RECEITA"]?.items || {}).map(([subCategory, value], index) => (
                  <tr key={index} className="sub-category">
                    <td>{subCategory}</td>
                    <td className={getValueClass(value)}>
                      {formatCurrency(value)}
                    </td>
                  </tr>
                ))}
                
                {/* Receita Líquida (Resultado Intermediário) */}
                <tr className="result-row">
                  <td>3. (=) RECEITA LÍQUIDA</td>
                  <td className={getValueClass(dreData.results?.receitaLiquida || 0, true)}>
                    {formatCurrency(dreData.results?.receitaLiquida || 0)}
                  </td>
                </tr>
                
                {/* Outras Receitas */}
                <tr className="main-category">
                  <td>4. (+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS</td>
                  <td className={getValueClass(dreData.categories?.["(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS"]?.total || 0, true)}>
                    {formatCurrency(dreData.categories?.["(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS"]?.total || 0)}
                  </td>
                </tr>
                
                {/* Detalhamento de Outras Receitas */}
                {Object.entries(dreData.categories?.["(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS"]?.items || {}).map(([subCategory, value], index) => (
                  <tr key={index} className="sub-category">
                    <td>{subCategory}</td>
                    <td className={getValueClass(value, true)}>
                      {formatCurrency(value)}
                    </td>
                  </tr>
                ))}
                
                {/* CMV */}
                <tr className="main-category">
                  <td>5. (-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)</td>
                  <td className={getValueClass(dreData.categories?.["(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)"]?.total || 0)}>
                    {formatCurrency(dreData.categories?.["(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)"]?.total || 0)}
                  </td>
                </tr>
                
                {/* Detalhamento do CMV */}
                {Object.entries(dreData.categories?.["(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)"]?.items || {}).map(([subCategory, value], index) => (
                  <tr key={index} className="sub-category">
                    <td>{subCategory}</td>
                    <td className={getValueClass(value)}>
                      {formatCurrency(value)}
                    </td>
                  </tr>
                ))}
                
                {/* Lucro Bruto (Resultado Intermediário) */}
                <tr className="result-row">
                  <td>6. (=) LUCRO BRUTO</td>
                  <td className={getValueClass(dreData.results?.lucroBruto || 0, true)}>
                    {formatCurrency(dreData.results?.lucroBruto || 0)}
                  </td>
                </tr>
                
                {/* Despesas Operacionais */}
                <tr className="main-category">
                  <td>7. (-) DESPESAS OPERACIONAIS</td>
                  <td className={getValueClass(dreData.categories?.["(-) DESPESAS OPERACIONAIS"]?.total || 0)}>
                    {formatCurrency(dreData.categories?.["(-) DESPESAS OPERACIONAIS"]?.total || 0)}
                  </td>
                </tr>
                
                {/* Detalhamento das Despesas Operacionais */}
                {Object.entries(dreData.categories?.["(-) DESPESAS OPERACIONAIS"]?.items || {}).map(([subCategory, value], index) => (
                  <tr key={index} className="sub-category">
                    <td>{subCategory}</td>
                    <td className={getValueClass(value)}>
                      {formatCurrency(value)}
                    </td>
                  </tr>
                ))}
                
                {/* Resultado Operacional (Resultado Intermediário) */}
                <tr className="result-row">
                  <td>8. (=) RESULTADO OPERACIONAL</td>
                  <td className={getValueClass(dreData.results?.resultadoOperacional || 0, true)}>
                    {formatCurrency(dreData.results?.resultadoOperacional || 0)}
                  </td>
                </tr>
                
                {/* Despesas com Sócios */}
                <tr className="main-category">
                  <td>9. (-) DESPESAS COM SÓCIOS</td>
                  <td className={getValueClass(dreData.categories?.["(-) DESPESAS COM SÓCIOS"]?.total || 0)}>
                    {formatCurrency(dreData.categories?.["(-) DESPESAS COM SÓCIOS"]?.total || 0)}
                  </td>
                </tr>
                
                {/* Detalhamento das Despesas com Sócios */}
                {Object.entries(dreData.categories?.["(-) DESPESAS COM SÓCIOS"]?.items || {}).map(([subCategory, value], index) => (
                  <tr key={index} className="sub-category">
                    <td>{subCategory}</td>
                    <td className={getValueClass(value)}>
                      {formatCurrency(value)}
                    </td>
                  </tr>
                ))}
                
                {/* Resultado Antes IR (Resultado Intermediário) */}
                <tr className="result-row">
                  <td>10. (=) RESULTADO ANTES DO IR</td>
                  <td className={getValueClass(dreData.results?.resultadoAntesIR || 0, true)}>
                    {formatCurrency(dreData.results?.resultadoAntesIR || 0)}
                  </td>
                </tr>
                
                {/* Investimentos */}
                <tr className="main-category">
                  <td>11. (-) INVESTIMENTOS</td>
                  <td className={getValueClass(dreData.categories?.["(-) INVESTIMENTOS"]?.total || 0)}>
                    {formatCurrency(dreData.categories?.["(-) INVESTIMENTOS"]?.total || 0)}
                  </td>
                </tr>
                
                {/* Detalhamento dos Investimentos */}
                {Object.entries(dreData.categories?.["(-) INVESTIMENTOS"]?.items || {}).map(([subCategory, value], index) => (
                  <tr key={index} className="sub-category">
                    <td>{subCategory}</td>
                    <td className={getValueClass(value)}>
                      {formatCurrency(value)}
                    </td>
                  </tr>
                ))}
                
                {/* Resultado Líquido (Resultado Final) */}
                <tr className="final-result-row">
                  <td>12. (=) RESULTADO LÍQUIDO</td>
                  <td className={getValueClass(dreData.results?.resultadoLiquido || 0, true)}>
                    {formatCurrency(dreData.results?.resultadoLiquido || 0)}
                  </td>
                </tr>
                
                {/* Transações não categorizadas (se existirem) */}
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
                    
                    {/* Detalhamento das transações não categorizadas - apenas mostrar se expandido */}
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
            
            <button className="back-button" onClick={() => navigate("/dashboard")}>
              Voltar ao Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DREReport;