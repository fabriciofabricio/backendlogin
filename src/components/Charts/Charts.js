// src/components/Charts/Charts.js - Versão atualizada
import React, { useState, useEffect, useCallback } from "react";
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
import { 
  LineChart, 
  Line, 
  BarChart, 
  Bar, 
  ResponsiveContainer, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  Cell
} from "recharts";
import MainLayout from "../Layout/MainLayout";
import "./Charts.css";

const Charts = () => {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [financialData, setFinancialData] = useState([]);
  const [error, setError] = useState("");

  const [selectedMetric, setSelectedMetric] = useState("resultadoFinal");
  const [categoryData, setCategoryData] = useState([]); // Store detailed category data
  const [availableCategories, setAvailableCategories] = useState([]); // List of all available categories
  const [selectedCategories, setSelectedCategories] = useState([]); // Selected categories for filtering
  const [filterByCategory, setFilterByCategory] = useState(false); // Toggle for category filtering

  const [excludeAportesChart, setExcludeAportesChart] = useState(false);
  const [excludeAportesTable, setExcludeAportesTable] = useState(false);
  const COLORS = ['#4caf50', '#ff9800', '#2196f3', '#f44336', '#9c27b0', '#00acc1', '#3f51b5', '#607d8b', '#795548', '#e91e63'];
  
  // Métricas disponíveis para visualização
  const metrics = [
    { id: "receitaBruta", name: "Receita Bruta" },
    { id: "custosDiretos", name: "Custos Diretos" },
    { id: "lucroBruto", name: "Lucro Bruto" },
    { id: "resultadoFinal", name: "Resultado Final" },
  ];

  // Function to calculate financial data for a specific period
  const calculateFinancialDataForPeriod = useCallback(async (period, periodLabel) => {
    try {
      // Inicializar valores financeiros
      const financialTotals = {
        totalTransactions: 0, // Guardar soma total das transações
        receitaBruta: 0,
        custosDiretos: 0,
        despesasOperacionais: 0,
        outrasReceitas: 0,
        despesasSocios: 0,
        investimentos: 0,
        naoCategorizado: 0
      };
      
      // Para armazenar dados detalhados por categoria
      const categoryDetails = {};
      
      // 1. Buscar arquivos OFX do período
      const ofxFilesQuery = query(
        collection(db, "ofxFiles"),
        where("userId", "==", auth.currentUser.uid),
        where("period", "==", period)
      );
      
      const ofxFilesSnapshot = await getDocs(ofxFilesQuery);
      
      // Se não houver arquivos, verificamos se existem entradas de dinheiro
      // antes de retornar valores zerados
      if (ofxFilesSnapshot.empty) {
        // Verificar se existem entradas de dinheiro para este período
        const cashEntriesQuery = query(
          collection(db, "cashEntries"),
          where("userId", "==", auth.currentUser.uid),
          where("period", "==", period)
        );
        
        const cashEntriesSnapshot = await getDocs(cashEntriesQuery);
        
        if (cashEntriesSnapshot.empty) {
          // Se não há arquivos OFX nem entradas de dinheiro, retornamos zeros
          return {
            periodSummary: {
              period,
              periodLabel,
              receitaBruta: 0,
              custosDiretos: 0,
              lucroBruto: 0,
              despesasOperacionais: 0,
              resultadoFinal: 0
            },
            periodCategories: {
              period,
              periodLabel,
              categories: {}
            }
          };
        }
      }
      
      // Buscar mapeamentos de categorias para processar as transações corretamente
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
      
      // Helper function to process transaction by category
      const processTransaction = (transaction, mainCategory, subCategory, categoryPath) => {
        // Adicionar ao total de todas as transações
        financialTotals.totalTransactions += transaction.amount;
        
        // Process by category type
        if (mainCategory === "RECEITA") {
          financialTotals.receitaBruta += transaction.amount;
        } 
        else if (mainCategory === "(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)") {
          financialTotals.custosDiretos += transaction.amount; // Sem Math.abs
        } 
        else if (mainCategory === "(-) DESPESAS OPERACIONAIS") {
          financialTotals.despesasOperacionais += transaction.amount; // Sem Math.abs
        }
        else if (mainCategory === "(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS") {
          financialTotals.outrasReceitas += transaction.amount;
        }
        else if (mainCategory === "(-) DESPESAS COM SÓCIOS") {
          financialTotals.despesasSocios += transaction.amount; // Sem Math.abs
        }
        else if (mainCategory === "(-) INVESTIMENTOS") {
          financialTotals.investimentos += transaction.amount; // Sem Math.abs
        }
        
        // Armazenar detalhes por categoria
        if (categoryPath) {
          if (!categoryDetails[categoryPath]) {
            categoryDetails[categoryPath] = {
              group: mainCategory,
              category: subCategory,
              value: 0
            };
          }
          categoryDetails[categoryPath].value += transaction.amount;
        }
      };
      
      // 2. Processar as transações de cada arquivo OFX
      for (const fileDoc of ofxFilesSnapshot.docs) {
        const fileData = fileDoc.data();
        
        if (!fileData.filePath) continue;
        
        try {
          // Obter o arquivo do Storage
          const storageRef = ref(storage, fileData.filePath);
          const blob = await getBlob(storageRef);
          const fileContent = await blob.text();
          
          // Importar a função de parse do OFX
          const { parseOFXContent } = await import("../../utils/OFXParser");
          const parseResult = parseOFXContent(fileContent);
          const transactions = parseResult.transactions;
          
          // Processar cada transação para calcular os totais por categoria
          for (const transaction of transactions) {
            const normalizedDescription = transaction.description.trim().toLowerCase();
            let mainCategory = null;
            let subCategory = null;
            let categoryPath = null;
            let isCategorized = false;
            
            // Primeiro verificar se existe um mapeamento específico para esta transação
            if (specificMappings[transaction.id]) {
              const specificMapping = specificMappings[transaction.id];
              mainCategory = specificMapping.groupName;
              subCategory = specificMapping.categoryName;
              categoryPath = specificMapping.categoryPath;
              isCategorized = true;
            } 
            // Se não existir mapeamento específico, verificar mapeamento normal
            else if (categoryMappings[normalizedDescription]) {
              const mapping = categoryMappings[normalizedDescription];
              if (!mapping.isSpecificMapping) {
                mainCategory = mapping.groupName;
                subCategory = mapping.categoryName;
                categoryPath = mapping.categoryPath;
                isCategorized = true;
              }
            }
            
            // Categorizar com base no grupo principal
            if (isCategorized) {
              processTransaction(
                transaction, 
                mainCategory, 
                subCategory, 
                categoryPath
              );
            } else {
              // Se não for categorizada, considerar como não categorizado
              financialTotals.naoCategorizado += transaction.amount;
              financialTotals.totalTransactions += transaction.amount;
            }
          }
        } catch (error) {
          console.error(`Erro ao processar arquivo OFX ${fileData.fileName}:`, error);
        }
      }

      // 3. Processar entradas de dinheiro para o período
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
              const subCategory = pathParts[1] || entry.category;
              
              // Process cash entry by category
              processTransaction(
                entry, 
                mainCategory, 
                subCategory, 
                entry.categoryPath
              );
            }
          }
        });
      } catch (error) {
        console.error(`Erro ao processar entradas de dinheiro para o período ${period}:`, error);
      }
      
      // Calcular valores derivados para display - agora usando valores com sinais corretos
      const lucroBruto = financialTotals.receitaBruta + financialTotals.custosDiretos;
      const resultadoOperacional = lucroBruto + financialTotals.despesasOperacionais + financialTotals.outrasReceitas;
      const resultadoAntesIR = resultadoOperacional + financialTotals.despesasSocios;
      
      // Para o resultado final, usar a soma de todas as transações
      const resultadoFinal = financialTotals.totalTransactions;
      
      return {
        periodSummary: {
          period,
          periodLabel,
          receitaBruta: financialTotals.receitaBruta,
          custosDiretos: financialTotals.custosDiretos,
          lucroBruto,
          despesasOperacionais: financialTotals.despesasOperacionais,
          outrasReceitas: financialTotals.outrasReceitas,
          resultadoOperacional,
          despesasSocios: financialTotals.despesasSocios,
          resultadoAntesIR,
          investimentos: financialTotals.investimentos,
          naoCategorizado: financialTotals.naoCategorizado,
          resultadoFinal,
          // Para exibição, também incluímos os valores absolutos
          custosDiretosAbs: Math.abs(financialTotals.custosDiretos),
          despesasOperacionaisAbs: Math.abs(financialTotals.despesasOperacionais),
          despesasSociosAbs: Math.abs(financialTotals.despesasSocios),
          investimentosAbs: Math.abs(financialTotals.investimentos)
        },
        periodCategories: {
          period,
          periodLabel,
          categories: categoryDetails
        }
      };
      
    } catch (error) {
      console.error(`Erro ao calcular dados para o período ${period}:`, error);
      return {
        periodSummary: {
          period,
          periodLabel,
          receitaBruta: 0,
          custosDiretos: 0,
          lucroBruto: 0,
          despesasOperacionais: 0,
          resultadoFinal: 0
        },
        periodCategories: {
          period,
          periodLabel,
          categories: {}
        }
      };
    }
  }, []);

  // Function to load all financial data for multiple periods
  const loadAllFinancialData = useCallback(async (periodsArray) => {
    const summaryResults = [];
    const categoryResults = [];
    
    for (const period of periodsArray) {
      // Calcular dados financeiros para cada período
      const { periodSummary, periodCategories } = await calculateFinancialDataForPeriod(period.value, period.label);
      
      summaryResults.push(periodSummary);
      categoryResults.push(periodCategories);
    }
    
    return {
      summaryData: summaryResults,
      categoryData: categoryResults
    };
  }, [calculateFinancialDataForPeriod]);

  // Load available categories
  const loadCategories = useCallback(async () => {
    try {
      if (!auth.currentUser) return;
      
      const userCategoriesDoc = await getDoc(doc(db, "userCategories", auth.currentUser.uid));
      
      if (userCategoriesDoc.exists()) {
        const categoriesData = userCategoriesDoc.data();
        
        if (categoriesData.categories) {
          const categoriesList = [];
          
          Object.keys(categoriesData.categories).forEach(path => {
            if (categoriesData.categories[path]) {
              const parts = path.split('.');
              if (parts.length === 2) {
                const group = parts[0];
                const category = parts[1];
                
                categoriesList.push({
                  id: path,
                  group: group,
                  name: category,
                  displayName: `${group} - ${category}`
                });
              }
            }
          });
          
          // Sort categories alphabetically by group then name
          categoriesList.sort((a, b) => {
            if (a.group !== b.group) return a.group.localeCompare(b.group);
            return a.name.localeCompare(b.name);
          });
          
          setAvailableCategories(categoriesList);
        }
      }
    } catch (error) {
      console.error("Erro ao carregar categorias:", error);
    }
  }, []);

  // Load periods data
  const loadPeriodsData = useCallback(async () => {
    try {
      if (!auth.currentUser) return;
      
      // Buscar períodos, mas sem usar orderBy para evitar necessidade de índice composto
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
      
      // Ordenar períodos manualmente depois de obtê-los
      uniquePeriods.sort((a, b) => a.value.localeCompare(b.value));
      
      setPeriods(uniquePeriods);
      
      // Se existem períodos, carregar dados financeiros
      if (uniquePeriods.length > 0) {
        const financialResults = await loadAllFinancialData(uniquePeriods);
        setFinancialData(financialResults.summaryData);
        setCategoryData(financialResults.categoryData);
      }
    } catch (error) {
      console.error("Erro ao carregar períodos:", error);
      setError("Não foi possível carregar os períodos disponíveis.");
    }
  }, [loadAllFinancialData]);

  // Carregar usuário e períodos disponíveis
  useEffect(() => {
    const loadUserAndData = async () => {
      try {
        setLoading(true);
        
        if (auth.currentUser) {
          setUser(auth.currentUser);
          await loadPeriodsData();
          await loadCategories();
        }
      } catch (error) {
        console.error("Erro ao carregar dados:", error);
        setError("Não foi possível carregar os dados. Tente novamente mais tarde.");
      } finally {
        setLoading(false);
      }
    };
    
    loadUserAndData();
  }, [loadPeriodsData, loadCategories]);

  // Handle category selection for filtering - ALTERADO: agora alterna categorias individuais
  const handleCategorySelection = (categoryId) => {
    setSelectedCategories(prevSelected => {
      // Se a categoria já está selecionada, removê-la
      if (prevSelected.includes(categoryId)) {
        return prevSelected.filter(id => id !== categoryId);
      } 
      // Caso contrário, adicioná-la
      else {
        return [...prevSelected, categoryId];
      }
    });
  };

  // Prepare data for charts based on selected filter
  const prepareChartData = () => {
    if (!filterByCategory || selectedCategories.length === 0) {
      // No category filter or no categories selected, use normal data
      return financialData.map(period => {
        // Se estiver excluindo aportes, calcular resultado final ajustado
        let resultadoFinalAjustado = period.resultadoFinal;
        
        // Procurar por aportes de sócios nos dados de categoria
        if (excludeAportesChart) {
          const periodCategoryData = categoryData.find(pc => pc.period === period.period);
          if (periodCategoryData && periodCategoryData.categories) {
            // Procurar categorias que contém "aporte" nos dados de categoria
            Object.entries(periodCategoryData.categories).forEach(([categoryPath, categoryData]) => {
              if (categoryPath.toLowerCase().includes('aporte') || 
                  (categoryData.category && categoryData.category.toLowerCase().includes('aporte'))) {
                // Subtrair o valor do aporte do resultado final
                resultadoFinalAjustado -= categoryData.value;
              }
            });
          }
        }
        
        // Para custos diretos, mostrar o valor absoluto para visualização
        const metricValue = selectedMetric === 'custosDiretos' ? 
                           (period['custosDiretosAbs'] || Math.abs(period[selectedMetric])) : 
                           (excludeAportesChart && selectedMetric === 'resultadoFinal' ? 
                              resultadoFinalAjustado : period[selectedMetric]);
        
        return {
          name: formatPeriod(period.period),
          value: metricValue
        };
      });
    }
    
    // When filtering by multiple categories, create data for each category
    const multiCategoryData = financialData.map((period, index) => {
      const result = { 
        name: formatPeriod(period.period)
      };
      
      // Add each selected category as a separate data point
      selectedCategories.forEach(categoryId => {
        const category = availableCategories.find(c => c.id === categoryId);
        const categoryName = category ? category.name : categoryId.split('.')[1];
        const periodCategoryData = categoryData[index].categories[categoryId];
        
        // Add category value if it exists
        result[categoryName] = periodCategoryData ? periodCategoryData.value : 0;
      });
      
      return result;
    });
    
    return multiCategoryData;
  };

  // Formatar data para exibição mais amigável
  const formatPeriod = (period) => {
    const foundPeriod = periods.find(p => p.value === period);
    return foundPeriod ? foundPeriod.label : period;
  };

  // Formatar valor monetário
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  // Renderizar gráfico de linha - Evolução ao longo do tempo
  const renderLineChart = () => {
    const data = prepareChartData();
    const metricName = filterByCategory && selectedCategories.length > 0 
      ? "Categorias Selecionadas" 
      : (metrics.find(m => m.id === selectedMetric)?.name || selectedMetric);
    
    const chartTitle = filterByCategory && selectedCategories.length > 0 
      ? "Evolução de Categorias por Período" 
      : `Evolução de ${metricName} por Período`;
    
    // Adicionar indicação de que os aportes foram excluídos
    const titleWithAportes = excludeAportesChart && !filterByCategory 
      ? `${chartTitle} (Excluindo Aportes)` 
      : chartTitle;
    
    return (
      <div className="chart-container">
        <h3>
          {titleWithAportes}
          {filterByCategory && selectedCategories.length > 0 && (
            <span className="selected-categories-count">{selectedCategories.length}</span>
          )}
        </h3>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart
            data={data}
            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis tickFormatter={(value) => formatCurrency(value)} />
            <Tooltip formatter={(value) => formatCurrency(value)} />
            <Legend />
            
            {filterByCategory && selectedCategories.length > 0 ? (
              // Quando filtrando por categorias, renderizar uma linha para cada categoria
              selectedCategories.map((categoryId, index) => {
                const category = availableCategories.find(c => c.id === categoryId);
                const categoryName = category ? category.name : categoryId.split('.')[1];
                
                return (
                  <Line 
                    key={categoryId}
                    type="monotone" 
                    dataKey={categoryName}
                    name={categoryName} // Mostra apenas o nome da categoria na legenda
                    stroke={COLORS[index % COLORS.length]} 
                    strokeWidth={2}
                    activeDot={{ r: 8 }}
                  />
                );
              })
            ) : (
              // Sem filtro de categoria, mostrar apenas a métrica selecionada
              <Line 
                type="monotone" 
                dataKey="value" 
                name={excludeAportesChart ? `${metricName} (Excluindo Aportes)` : metricName}
                stroke="#4caf50" 
                strokeWidth={2}
                activeDot={{ r: 8 }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  };

  // Valor padrão para tipo de gráfico
  const [activeChart, setActiveChart] = useState("bar"); // Mudando o padrão para barras

  // Renderizar gráfico de barras - Comparação entre períodos
  const renderBarChart = () => {
    const data = prepareChartData();
    const metricName = filterByCategory && selectedCategories.length > 0 
      ? "Categorias Selecionadas" 
      : (metrics.find(m => m.id === selectedMetric)?.name || selectedMetric);
    
    const chartTitle = filterByCategory && selectedCategories.length > 0 
      ? "Comparação de Categorias por Período" 
      : `Comparação de ${metricName} por Período`;
    
    // Adicionar indicação de que os aportes foram excluídos
    const titleWithAportes = excludeAportesChart && !filterByCategory 
      ? `${chartTitle} (Excluindo Aportes)` 
      : chartTitle;
    
    return (
      <div className="chart-container">
        <h3>
          {titleWithAportes}
          {filterByCategory && selectedCategories.length > 0 && (
            <span className="selected-categories-count">{selectedCategories.length}</span>
          )}
        </h3>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart
            data={data}
            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis tickFormatter={(value) => formatCurrency(value)} />
            <Tooltip formatter={(value) => formatCurrency(value)} />
            <Legend />
            
            {filterByCategory && selectedCategories.length > 0 ? (
              // Quando filtrando por categorias, renderizar uma barra para cada categoria
              selectedCategories.map((categoryId, index) => {
                const category = availableCategories.find(c => c.id === categoryId);
                const categoryName = category ? category.name : categoryId.split('.')[1];
                
                return (
                  <Bar 
                    key={categoryId}
                    dataKey={categoryName}
                    name={categoryName} // Mostra apenas o nome da categoria na legenda
                    fill={COLORS[index % COLORS.length]}
                    // Reduzir o tamanho das barras quando houver múltiplas categorias
                    barSize={Math.max(40 - (selectedCategories.length * 2), 15)}
                  />
                );
              })
            ) : (
              // Sem filtro de categoria, mostrar apenas a métrica selecionada
              <Bar 
                dataKey="value" 
                name={excludeAportesChart ? `${metricName} (Excluindo Aportes)` : metricName}
                fill="#2196f3"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };



  // Preparar dados para tabela de resumo e realizar cálculos adicionais
  const prepareSummaryTableData = () => {
    let results = [];

    if (!filterByCategory || selectedCategories.length === 0) {
      // Sem filtro de categoria, processar dados normais
      results = financialData.map(period => {
        // Se estiver excluindo aportes, calcular resultado final ajustado
        let resultadoFinalAjustado = period.resultadoFinal;
        
        // Procurar por aportes de sócios nos dados de categoria
        if (excludeAportesTable) {
          const periodCategoryData = categoryData.find(pc => pc.period === period.period);
          if (periodCategoryData && periodCategoryData.categories) {
            // Procurar categorias que contém "aporte" nos dados de categoria
            Object.entries(periodCategoryData.categories).forEach(([categoryPath, categoryData]) => {
              if (categoryPath.toLowerCase().includes('aporte') || 
                  (categoryData.category && categoryData.category.toLowerCase().includes('aporte'))) {
                // Subtrair o valor do aporte do resultado final
                resultadoFinalAjustado -= categoryData.value;
              }
            });
          }
        }
        
        return {
          ...period,
          resultadoFinalAjustado,
          // Usar valores absolutos para exibição de custos
          custosDiretosAbs: period.custosDiretosAbs || Math.abs(period.custosDiretos)
        };
      });
    } else {
      // Com filtro de categorias, processar dados filtrados
      results = financialData.map((period, index) => {
        const result = { ...period };
        const categoriesForPeriod = categoryData[index]?.categories || {};
        
        // Adicionar cada categoria selecionada como uma propriedade separada
        selectedCategories.forEach(categoryId => {
          const category = availableCategories.find(c => c.id === categoryId);
          const categoryName = category ? category.name : categoryId.split('.')[1];
          
          result[categoryName] = categoriesForPeriod[categoryId]?.value || 0;
        });
        
        return result;
      });
    }
    
    return results;
  };

  return (
    <MainLayout userName={user?.displayName || "Usuário"}>
      <div className="charts-container">
        <div className="charts-header">
          <h1>Gráficos Financeiros</h1>
        </div>
        
        {error && (
          <div className="error-message">
            {error}
          </div>
        )}
        
        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Carregando dados dos períodos...</p>
          </div>
        ) : financialData.length === 0 ? (
          <div className="no-data-message">
            <p>Nenhum dado financeiro disponível. Importe arquivos OFX para visualizar gráficos.</p>
          </div>
        ) : (
          <>
            <div className="charts-controls">
              <div className="chart-type-selector">
                <label>Tipo de Gráfico:</label>
                <div className="chart-buttons">
                  <button 
                    className={`chart-button ${activeChart === 'bar' ? 'active' : ''}`}
                    onClick={() => setActiveChart('bar')}
                  >
                    <span className="chart-icon">📊</span> Barras
                  </button>
                  <button 
                    className={`chart-button ${activeChart === 'line' ? 'active' : ''}`}
                    onClick={() => setActiveChart('line')}
                  >
                    <span className="chart-icon">📈</span> Linha
                  </button>
                </div>
              </div>
              
              {/* Controles de filtro de categoria aprimorados */}
              <div className="filter-controls">
                <div className="exclude-aportes-control">
                  <label className="exclude-aportes-toggle">
                    <input 
                      type="checkbox" 
                      checked={excludeAportesChart}
                      onChange={() => setExcludeAportesChart(!excludeAportesChart)}
                    />
                    <span>Excluir aportes de sócios do cálculo do Resultado Final</span>
                    {excludeAportesChart && (
                      <span className="active-filter-indicator">Filtro ativo</span>
                    )}
                  </label>
                </div>
                
                <div className="filter-toggle">
                  <label>
                    <input 
                      type="checkbox" 
                      checked={filterByCategory}
                      onChange={() => {
                        setFilterByCategory(!filterByCategory);
                        // Limpar seleções quando desabilitar o filtro
                        if (filterByCategory) setSelectedCategories([]);
                      }}
                    />
                    Filtrar por categorias específicas
                    {filterByCategory && (
                      <span className="active-filter-indicator">Filtro ativo</span>
                    )}
                  </label>
                </div>
                
                {filterByCategory && (
                  <div className="improved-category-selector">
                    <div className="category-selector-header">
                      <label>Selecione as categorias:</label>
                      {selectedCategories.length > 0 && (
                        <button 
                          className="clear-selection-button"
                          onClick={() => setSelectedCategories([])}
                        >
                          Limpar seleção
                        </button>
                      )}
                    </div>
                    
                    <div className="category-grid">
                      {availableCategories.map(category => (
                        <div 
                          key={category.id}
                          className={`category-card ${selectedCategories.includes(category.id) ? 'selected' : ''}`}
                          onClick={() => handleCategorySelection(category.id)}
                          title={`Grupo: ${category.group}`} 
                        >
                          <div className="category-card-content">
                            <div className="category-checkbox">
                              <input 
                                type="checkbox" 
                                checked={selectedCategories.includes(category.id)}
                                readOnly
                              />
                            </div>
                            <div className="category-info">
                              <div className="category-name">{category.name}</div>
                              <div className="category-badge">{category.group.includes('CMV') ? 'CMV' : 
                                category.group.includes('RECEITA') ? 'Receita' : 
                                category.group.includes('DESPESAS') ? 'Despesa' : 
                                'Outro'}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {selectedCategories.length > 0 && (
                      <div className="selected-categories-summary">
                        {selectedCategories.length} categorias selecionadas
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              {!filterByCategory && activeChart !== 'comparison' && (
                <div className="metric-selector">
                  <label>Métrica:</label>
                  <select 
                    value={selectedMetric}
                    onChange={(e) => setSelectedMetric(e.target.value)}
                  >
                    {metrics.map(metric => (
                      <option key={metric.id} value={metric.id}>{metric.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            
            <div className="charts-content">
              {activeChart === 'bar' && renderBarChart()}
              {activeChart === 'line' && renderLineChart()}
            </div>
            
            <div className="periods-summary">
              <h3>Resumo dos Períodos</h3>
              
              <div className="summary-controls">
                <label className="exclude-aportes-toggle">
                  <input 
                    type="checkbox" 
                    checked={excludeAportesTable}
                    onChange={() => setExcludeAportesTable(!excludeAportesTable)}
                  />
                  <span>Excluir aportes de sócios do cálculo do Resultado Final</span>
                </label>
              </div>
              
              <div className="summary-table-container">
                <table className="summary-table">
                  <thead>
                    <tr>
                      <th>Período</th>
                      {filterByCategory && selectedCategories.length > 0 ? (
                        // Mostrar colunas para cada categoria selecionada
                        selectedCategories.map(categoryId => {
                          const category = availableCategories.find(c => c.id === categoryId);
                          return (
                            <th key={categoryId}>
                              {category?.name || categoryId.split('.')[1]}
                            </th>
                          );
                        })
                      ) : (
                        // Colunas padrão para métricas financeiras
                        <>
                          <th>Receita Bruta</th>
                          <th>Custos Diretos</th>
                          <th>Lucro Bruto</th>
                          <th>Resultado Final</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {prepareSummaryTableData().map((period, index) => (
                      <tr key={index}>
                        <td>{formatPeriod(period.period)}</td>
                        {filterByCategory && selectedCategories.length > 0 ? (
                          // Células para cada categoria selecionada
                          selectedCategories.map(categoryId => {
                            const category = availableCategories.find(c => c.id === categoryId);
                            const categoryName = category ? category.name : categoryId.split('.')[1];
                            const value = period[categoryName] || 0;
                            
                            return (
                              <td key={categoryId} className={value >= 0 ? "amount-positive" : "amount-negative"}>
                                {formatCurrency(value)}
                              </td>
                            );
                          })
                        ) : (
                          // Células padrão para métricas financeiras
                          <>
                            <td className="amount-positive">{formatCurrency(period.receitaBruta)}</td>
                            <td className="amount-negative">{formatCurrency(period.custosDiretosAbs)}</td>
                            <td className={period.lucroBruto >= 0 ? "amount-positive" : "amount-negative"}>
                              {formatCurrency(period.lucroBruto)}
                            </td>
                            <td className={period.resultadoFinalAjustado >= 0 ? "amount-positive" : "amount-negative"}>
                              {formatCurrency(excludeAportesTable ? period.resultadoFinalAjustado : period.resultadoFinal)}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                    
                    {/* Linha de totais */}
                    {!filterByCategory || selectedCategories.length === 0 ? (
                      <tr className="total-row">
                        <td><strong>TOTAL</strong></td>
                        <td className="amount-positive">
                          {formatCurrency(prepareSummaryTableData().reduce((sum, period) => sum + period.receitaBruta, 0))}
                        </td>
                        <td className="amount-negative">
                          {formatCurrency(prepareSummaryTableData().reduce((sum, period) => sum + period.custosDiretosAbs, 0))}
                        </td>
                        <td className={prepareSummaryTableData().reduce((sum, period) => sum + period.lucroBruto, 0) >= 0 ? "amount-positive" : "amount-negative"}>
                          {formatCurrency(prepareSummaryTableData().reduce((sum, period) => sum + period.lucroBruto, 0))}
                        </td>
                        <td className={prepareSummaryTableData().reduce((sum, period) => sum + (excludeAportesTable ? period.resultadoFinalAjustado : period.resultadoFinal), 0) >= 0 ? "amount-positive" : "amount-negative"}>
                          {formatCurrency(prepareSummaryTableData().reduce((sum, period) => sum + (excludeAportesTable ? period.resultadoFinalAjustado : period.resultadoFinal), 0))}
                        </td>
                      </tr>
                    ) : (
                      <tr className="total-row">
                        <td><strong>TOTAL</strong></td>
                        {selectedCategories.map(categoryId => {
                          const category = availableCategories.find(c => c.id === categoryId);
                          const categoryName = category ? category.name : categoryId.split('.')[1];
                          
                          // Calcular o total para esta categoria em todos os períodos
                          const totalValue = prepareSummaryTableData().reduce((sum, period) => 
                            sum + (period[categoryName] || 0), 0);
                          
                          return (
                            <td key={categoryId} className={totalValue >= 0 ? "amount-positive" : "amount-negative"}>
                              {formatCurrency(totalValue)}
                            </td>
                          );
                        })}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </MainLayout>
  );
};

export default Charts;