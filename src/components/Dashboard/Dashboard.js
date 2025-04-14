// src/components/Dashboard/Dashboard.js
import React, { useState, useEffect, useCallback } from "react";
import { auth, db, storage } from "../../firebase/config";
import { 
  doc, 
  getDoc, 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy, 
  limit 
} from "firebase/firestore";
import { ref, getBlob } from "firebase/storage";
import { parseOFXContent } from "../../utils/OFXParser";
import MainLayout from "../Layout/MainLayout";
import "./Dashboard.css";

const Dashboard = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [categoriesData, setCategoriesData] = useState(null);
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [error, setError] = useState("");
  const [financialData, setFinancialData] = useState({
    receitaBruta: 0,
    custosDiretos: 0,
    lucroBruto: 0,
    resultadoFinal: 0
  });
  const [currentPeriod, setCurrentPeriod] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [periods, setPeriods] = useState([]);
  const [loadingFinancialData, setLoadingFinancialData] = useState(false);

  // Carregar dados financeiros do período selecionado
  const loadFinancialData = useCallback(async (period) => {
    try {
      setLoadingFinancialData(true);
      
      if (!auth.currentUser) return;
      
      // Resetar dados financeiros
      const initialData = {
        receitaBruta: 0,
        custosDiretos: 0,
        lucroBruto: 0,
        resultadoFinal: 0,
        despesasOperacionais: 0,
        outrasReceitas: 0,
        despesasSocios: 0,
        investimentos: 0,
        naoCategorizado: 0,
        totalTransactions: 0
      };
      
      // Buscar categorias e mapeamentos necessários para o processamento
      const categoryMappingsDoc = await getDoc(doc(db, "categoryMappings", auth.currentUser.uid));
      const categoryMappings = categoryMappingsDoc.exists() ? categoryMappingsDoc.data().mappings || {} : {};
      
      // Identificar mapeamentos específicos por ID de transação
      const specificMappings = {};
      
      // Extrair mapeamentos específicos (para transações únicas)
      Object.entries(categoryMappings).forEach(([key, mapping]) => {
        if (mapping.isSpecificMapping && mapping.transactionId) {
          specificMappings[mapping.transactionId] = mapping;
        }
      });
      
      // 1. Buscar arquivos OFX do período selecionado
      const ofxFilesQuery = query(
        collection(db, "ofxFiles"),
        where("userId", "==", auth.currentUser.uid),
        where("period", "==", period)
      );
      
      const ofxFilesSnapshot = await getDocs(ofxFilesQuery);
      
      // Processar cada arquivo OFX
      for (const fileDoc of ofxFilesSnapshot.docs) {
        const fileData = fileDoc.data();
        
        if (fileData.filePath) {
          try {
            const storageRef = ref(storage, fileData.filePath);
            const blob = await getBlob(storageRef);
            const fileContent = await blob.text();
            const parseResult = parseOFXContent(fileContent);
            const transactions = parseResult.transactions;
            
            // Somar todas as transações para o resultado final
            for (const transaction of transactions) {
              // Processar categorias para outros dados financeiros
              const normalizedDescription = transaction.description.trim().toLowerCase();
              let mainCategory = null;
              let isCategorized = false;
              
              // Primeiro verificar se existe um mapeamento específico para esta transação
              if (specificMappings[transaction.id]) {
                const specificMapping = specificMappings[transaction.id];
                mainCategory = specificMapping.groupName;
                isCategorized = true;
              } 
              // Se não existir mapeamento específico, verificar mapeamento normal
              else if (categoryMappings[normalizedDescription]) {
                const mapping = categoryMappings[normalizedDescription];
                if (!mapping.isSpecificMapping) { // Não é um mapeamento específico para outra transação
                  mainCategory = mapping.groupName;
                  isCategorized = true;
                }
              }
              
              // Categorizar transação com base no mapeamento
              if (isCategorized) {
                if (mainCategory === "RECEITA") {
                  initialData.receitaBruta += transaction.amount;
                } else if (mainCategory === "(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)") {
                  initialData.custosDiretos += Math.abs(transaction.amount);
                } else if (mainCategory === "(-) DESPESAS OPERACIONAIS") {
                  initialData.despesasOperacionais += Math.abs(transaction.amount);
                } else if (mainCategory === "(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS") {
                  initialData.outrasReceitas += transaction.amount;
                } else if (mainCategory === "(-) DESPESAS COM SÓCIOS") {
                  initialData.despesasSocios += Math.abs(transaction.amount);
                } else if (mainCategory === "(-) INVESTIMENTOS") {
                  initialData.investimentos += Math.abs(transaction.amount);
                }
              } else {
                // Transação não categorizada - incluir no valor não categorizado
                initialData.naoCategorizado += transaction.amount;
              }
            }
          } catch (error) {
            console.error(`Erro ao processar arquivo OFX ${fileData.fileName}:`, error);
          }
        }
      }
      
      // 2. NOVO: Buscar e processar entradas de dinheiro para o período
      try {
        const cashEntriesQuery = query(
          collection(db, "cashEntries"),
          where("userId", "==", auth.currentUser.uid),
          where("period", "==", period)
        );
        
        const cashEntriesSnapshot = await getDocs(cashEntriesQuery);
        
        // Processar cada entrada de dinheiro
        cashEntriesSnapshot.forEach(doc => {
          const entry = doc.data();
          
          // Verificar se a entrada tem categoria e valor
          if (entry.categoryPath && typeof entry.amount === 'number') {
            const pathParts = entry.categoryPath.split('.');
            
            if (pathParts.length >= 2) {
              const mainCategory = pathParts[0];
              
              // Categorizar com base no grupo principal
              if (mainCategory === "RECEITA") {
                initialData.receitaBruta += entry.amount;
              } else if (mainCategory === "(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)") {
                initialData.custosDiretos += Math.abs(entry.amount);
              } else if (mainCategory === "(-) DESPESAS OPERACIONAIS") {
                initialData.despesasOperacionais += Math.abs(entry.amount);
              } else if (mainCategory === "(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS") {
                initialData.outrasReceitas += entry.amount;
              } else if (mainCategory === "(-) DESPESAS COM SÓCIOS") {
                initialData.despesasSocios += Math.abs(entry.amount);
              } else if (mainCategory === "(-) INVESTIMENTOS") {
                initialData.investimentos += Math.abs(entry.amount);
              }
              
              console.log(`Entrada de dinheiro processada no Dashboard: ${formatCurrency(entry.amount)} em ${mainCategory}`);
            }
          }
        });
      } catch (error) {
        console.error("Erro ao carregar entradas de dinheiro:", error);
      }
      
      // Calcular valores derivados conforme DRE
      initialData.lucroBruto = initialData.receitaBruta - initialData.custosDiretos;
      const resultadoOperacional = initialData.lucroBruto - initialData.despesasOperacionais + initialData.outrasReceitas;
      const resultadoAntesIR = resultadoOperacional - initialData.despesasSocios;
      
      // Incluir transações não categorizadas no resultado final (mesma lógica do DRE)
      initialData.resultadoFinal = resultadoAntesIR - initialData.investimentos + initialData.naoCategorizado;
      
      // Adicionar log para depuração
      console.log("Valores financeiros calculados:", {
        periodo: period,
        receitaBruta: initialData.receitaBruta,
        custosDiretos: initialData.custosDiretos,
        lucroBruto: initialData.lucroBruto,
        despesasOperacionais: initialData.despesasOperacionais,
        outrasReceitas: initialData.outrasReceitas,
        resultadoOperacional: resultadoOperacional,
        despesasSocios: initialData.despesasSocios,
        resultadoAntesIR: resultadoAntesIR,
        investimentos: initialData.investimentos,
        naoCategorizado: initialData.naoCategorizado,
        resultadoFinal: initialData.resultadoFinal,
      });
      
      // Calcular percentuais
      if (initialData.receitaBruta > 0) {
        initialData.custosDiretosPercent = (initialData.custosDiretos / initialData.receitaBruta) * 100;
        initialData.lucroBrutoPercent = (initialData.lucroBruto / initialData.receitaBruta) * 100;
        initialData.resultadoFinalPercent = (initialData.resultadoFinal / initialData.receitaBruta) * 100;
      } else {
        initialData.custosDiretosPercent = 0;
        initialData.lucroBrutoPercent = 0;
        initialData.resultadoFinalPercent = 0;
      }
      
      setFinancialData(initialData);
    } catch (error) {
      console.error("Erro ao carregar dados financeiros:", error);
      setError("Não foi possível carregar os dados financeiros para o período selecionado.");
    } finally {
      setLoadingFinancialData(false);
    }
  }, []);  // Empty dependency array as this function doesn't rely on any component state

  // Buscar períodos disponíveis - make the function memoized
  const loadAvailablePeriods = useCallback(async () => {
    try {
      if (!auth.currentUser) return;
      
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
      
      // Ordenar os períodos (mais recente primeiro)
      uniquePeriods.sort((a, b) => b.value.localeCompare(a.value));
      setPeriods(uniquePeriods);
      
      // Verificar se existe um período salvo no localStorage
      let savedPeriod = localStorage.getItem('selectedPeriod');
      let periodToUse;
      let periodLabelToUse;
      
      if (savedPeriod && uniquePeriods.find(p => p.value === savedPeriod)) {
        // Se existir um período salvo e ele estiver disponível, usar ele
        periodToUse = savedPeriod;
        const savedPeriodObj = uniquePeriods.find(p => p.value === savedPeriod);
        periodLabelToUse = savedPeriodObj.label;
      } else if (uniquePeriods.length > 0) {
        // Caso contrário, usar o período mais recente
        periodToUse = uniquePeriods[0].value;
        periodLabelToUse = uniquePeriods[0].label;
        // Salvar no localStorage
        localStorage.setItem('selectedPeriod', periodToUse);
      }
      
      if (periodToUse) {
        setCurrentPeriod(periodToUse);
        setPeriodLabel(periodLabelToUse);
        await loadFinancialData(periodToUse);
      }
    } catch (error) {
      console.error("Erro ao carregar períodos:", error);
      setError("Não foi possível carregar os períodos disponíveis.");
    }
  }, [loadFinancialData]);  // Added loadFinancialData to dependencies

  useEffect(() => {
    const fetchUserData = async () => {
      if (auth.currentUser) {
        setUser(auth.currentUser);
        
        try {
          // Buscar categorias do usuário
          const userCategoriesDoc = await getDoc(doc(db, "userCategories", auth.currentUser.uid));
          
          if (userCategoriesDoc.exists()) {
            const data = userCategoriesDoc.data();
            setCategoriesData(data);
          }
          
          // Buscar transações recentes para o usuário atual
          const transactionsQuery = query(
            collection(db, "transactions"),
            where("userId", "==", auth.currentUser.uid),
            orderBy("date", "desc"),
            limit(5)
          );
          
          const transactionsSnapshot = await getDocs(transactionsQuery);
          const transactionsData = [];
          
          transactionsSnapshot.forEach((doc) => {
            const data = doc.data();
            transactionsData.push({
              id: doc.id,
              ...data,
              date: data.date?.toDate() || new Date()
            });
          });
          
          setRecentTransactions(transactionsData);
          
          // Buscar períodos disponíveis
          await loadAvailablePeriods();
        } catch (error) {
          console.error("Erro ao buscar dados:", error);
          setError("Houve um erro ao carregar seus dados. Por favor, tente novamente.");
        }
      }
      
      setLoading(false);
    };

    fetchUserData();
  }, [loadAvailablePeriods]);

  // Função para tratar mudança de período
  const handlePeriodChange = async (event) => {
    const period = event.target.value;
    setCurrentPeriod(period);
    
    // Encontrar o label do período selecionado
    const selectedPeriod = periods.find(p => p.value === period);
    if (selectedPeriod) {
      setPeriodLabel(selectedPeriod.label);
    }
    
    // Salvar o período selecionado no localStorage
    localStorage.setItem('selectedPeriod', period);
    
    await loadFinancialData(period);
  };

  // Formatar valor monetário
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  // Formatar data
  const formatDate = (date) => {
    return new Intl.DateTimeFormat('pt-BR').format(date);
  };

  // Organizar as categorias em grupos e subgrupos - NOW USED IN THE COMPONENT RENDERING
  const organizeCategories = () => {
    if (!categoriesData || !categoriesData.categories) {
      return {
        groupedCategories: {},
        totalCategories: 0
      };
    }

    const categories = categoriesData.categories;
    const categoryOrder = categoriesData.categoryOrder || {};
    
    const selectedKeys = Object.keys(categories).filter(key => categories[key] === true);
    const groupedCategories = {};

    // Processar cada chave
    selectedKeys.forEach(key => {
      const parts = key.split('.');
      
      // Obter o grupo (primeira parte)
      const groupName = parts[0];
      
      // Inicializar o grupo se não existir
      if (!groupedCategories[groupName]) {
        // Usar a ordem se disponível, ou um número alto para categorias sem ordem
        const order = categoryOrder[groupName] || 999;
        groupedCategories[groupName] = {
          normalCategories: [],
          subGroups: {},
          order: order
        };
      }
      
      // Verificar se tem 2 ou 3 partes (com ou sem subgrupo)
      if (parts.length === 2) {
        // Sem subgrupo: grupo.categoria
        groupedCategories[groupName].normalCategories.push(parts[1]);
      } else if (parts.length === 3) {
        // Com subgrupo: grupo.subgrupo.categoria
        const subGroupName = parts[1];
        const categoryName = parts[2];
        
        if (!groupedCategories[groupName].subGroups[subGroupName]) {
          groupedCategories[groupName].subGroups[subGroupName] = [];
        }
        
        groupedCategories[groupName].subGroups[subGroupName].push(categoryName);
      }
    });

    return {
      groupedCategories,
      totalCategories: selectedKeys.length
    };
  };

  if (loading) {
    return (
      <MainLayout>
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Carregando dados...</p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout userName={user?.displayName || "Usuário"}>
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {/* Seletor de período */}
      <div className="period-selector-container">
        <div className="period-selector-header">
          <h2>Dados Financeiros {periodLabel && `- ${periodLabel}`}</h2>
          <div className="period-dropdown">
            <label htmlFor="period-select">Período: </label>
            <select
              id="period-select"
              value={currentPeriod}
              onChange={handlePeriodChange}
              disabled={loadingFinancialData || periods.length === 0}
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
      </div>

      {/* Cards Financeiros */}
      <div className="card-container">
        <div className="fin-card fin-card-receipts">
          <div className="fin-card-title">RECEITAS</div>
          <div className="fin-card-value">
            {loadingFinancialData ? (
              <span className="loading-text">Carregando...</span>
            ) : (
              formatCurrency(financialData.receitaBruta)
            )}
          </div>
          <div className="fin-card-description">Total de receitas no período</div>
          <div className="fin-card-footer">
            <div className="empty-space"></div>
          </div>
        </div>

        <div className="fin-card fin-card-costs">
          <div className="fin-card-title">CUSTOS DIRETOS</div>
          <div className="fin-card-value">
            {loadingFinancialData ? (
              <span className="loading-text">Carregando...</span>
            ) : (
              formatCurrency(financialData.custosDiretos)
            )}
          </div>
          <div className="fin-card-description">Total de custos diretos</div>
          <div className="fin-card-footer">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ 
                  width: `${financialData.custosDiretosPercent}%`, 
                  backgroundColor: '#00acc1' 
                }}
              ></div>
            </div>
            <div className="progress-text">
              {loadingFinancialData ? 
                "Calculando..." : 
                `${Math.round(financialData.custosDiretosPercent || 0)}% das receitas`
              }
            </div>
          </div>
        </div>

        <div className="fin-card fin-card-profit">
          <div className="fin-card-title">LUCRO BRUTO</div>
          <div className="fin-card-value">
            {loadingFinancialData ? (
              <span className="loading-text">Carregando...</span>
            ) : (
              formatCurrency(financialData.lucroBruto)
            )}
          </div>
          <div className="fin-card-description">Receitas - Custos Diretos</div>
          <div className="fin-card-footer">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ 
                  width: `${financialData.lucroBrutoPercent}%`, 
                  backgroundColor: '#2196f3' 
                }}
              ></div>
            </div>
            <div className="progress-text">
              {loadingFinancialData ? 
                "Calculando..." : 
                `${Math.round(financialData.lucroBrutoPercent || 0)}% das receitas`
              }
            </div>
          </div>
        </div>

        <div className="fin-card fin-card-result">
          <div className="fin-card-title">RESULTADO FINAL</div>
          <div className="fin-card-value">
            {loadingFinancialData ? (
              <span className="loading-text">Carregando...</span>
            ) : (
              formatCurrency(financialData.resultadoFinal)
            )}
          </div>
          <div className="fin-card-description">Resultado líquido do período</div>
          <div className="fin-card-footer">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ 
                  width: `${financialData.resultadoFinalPercent}%`, 
                  backgroundColor: '#ff9800' 
                }}
              ></div>
            </div>
            <div className="progress-text">
              {loadingFinancialData ? 
                "Calculando..." : 
                `${Math.round(financialData.resultadoFinalPercent || 0)}% das receitas`
              }
            </div>
          </div>
        </div>
      </div>

      {/* Adicionar nova seção para utilizar a função organizeCategories */}
      {categoriesData && (
        <div className="categories-section">
          <div className="section-header">
            <h2 className="section-title">Categorias</h2>
          </div>
          <div className="categories-summary">
            {(() => {
              const { groupedCategories, totalCategories } = organizeCategories();
              
              if (totalCategories === 0) {
                return <p>Nenhuma categoria configurada.</p>;
              }
              
              // Mostrar apenas o número de categorias por grupo para simplificar
              return (
                <div className="category-groups-list">
                  <p>Total de {totalCategories} categorias configuradas nos seguintes grupos:</p>
                  <ul>
                    {Object.entries(groupedCategories)
                      .sort(([, a], [, b]) => a.order - b.order)
                      .map(([groupName, group]) => {
                        const normalCount = group.normalCategories.length;
                        const subGroupCount = Object.keys(group.subGroups).length;
                        let subCatCount = 0;
                        
                        Object.values(group.subGroups).forEach(cats => {
                          subCatCount += cats.length;
                        });
                        
                        const totalGroupCount = normalCount + subCatCount;
                        
                        return (
                          <li key={groupName}>
                            <strong>{groupName}:</strong> {totalGroupCount} categorias
                            {subGroupCount > 0 && ` (${subGroupCount} subgrupos)`}
                          </li>
                        );
                      })}
                  </ul>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Transações recentes */}
      {recentTransactions.length > 0 && (
        <div className="transactions-section">
          <div className="section-header">
            <h2 className="section-title">Transações Recentes</h2>
            <button 
              className="view-all-button"
              onClick={() => window.location.href = '/transactions'}
            >
              Ver Todas as Transações
            </button>
          </div>
          
          <div className="transactions-table-container">
            <table className="transactions-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Categoria</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {recentTransactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{formatDate(transaction.date)}</td>
                    <td>{transaction.description}</td>
                    <td>
                      <span className="category-badge">{transaction.category || "Não categorizado"}</span>
                    </td>
                    <td className={transaction.amount >= 0 ? 'amount-positive' : 'amount-negative'}>
                      {formatCurrency(transaction.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </MainLayout>
  );
};

export default Dashboard;