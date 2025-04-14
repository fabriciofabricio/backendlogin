// src/components/Charts/Charts.js
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
  PieChart, 
  Pie, 
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
  const [activeChart, setActiveChart] = useState("line");
  const [selectedMetric, setSelectedMetric] = useState("resultadoFinal");
  const [categoryData, setCategoryData] = useState([]); // Store detailed category data
  const [availableCategories, setAvailableCategories] = useState([]); // List of all available categories
  const [selectedCategories, setSelectedCategories] = useState([]); // Selected categories for filtering
  const [filterByCategory, setFilterByCategory] = useState(false); // Toggle for category filtering

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
        totalTransactions: 0,
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
        // Process by category type
        if (mainCategory === "RECEITA") {
          financialTotals.receitaBruta += transaction.amount;
        } 
        else if (mainCategory === "(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)") {
          financialTotals.custosDiretos += Math.abs(transaction.amount);
        } 
        else if (mainCategory === "(-) DESPESAS OPERACIONAIS") {
          financialTotals.despesasOperacionais += Math.abs(transaction.amount);
        }
        else if (mainCategory === "(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS") {
          financialTotals.outrasReceitas += transaction.amount;
        }
        else if (mainCategory === "(-) DESPESAS COM SÓCIOS") {
          financialTotals.despesasSocios += Math.abs(transaction.amount);
        }
        else if (mainCategory === "(-) INVESTIMENTOS") {
          financialTotals.investimentos += Math.abs(transaction.amount);
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
            
            // Adicionar ao total geral
            financialTotals.totalTransactions += transaction.amount;
            
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
              
              // Adicionar ao total geral
              financialTotals.totalTransactions += entry.amount;
              
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
      
      // Calcular valores derivados usando a mesma lógica do DRE
      const lucroBruto = financialTotals.receitaBruta - financialTotals.custosDiretos;
      const resultadoOperacional = lucroBruto - financialTotals.despesasOperacionais + financialTotals.outrasReceitas;
      const resultadoAntesIR = resultadoOperacional - financialTotals.despesasSocios;
      // Incluir o valor das transações não categorizadas como no DRE
      const resultadoFinal = resultadoAntesIR - financialTotals.investimentos + financialTotals.naoCategorizado;
      
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
          resultadoFinal
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

  // Toggle category filter mode
  const toggleCategoryFilter = () => {
    setFilterByCategory(!filterByCategory);
    
    // Reset selected categories when disabling filter
    if (filterByCategory) {
      setSelectedCategories([]);
    }
  };

  // Handle category selection for filtering
  const handleCategorySelection = (e) => {
    const selectedOptions = Array.from(e.target.selectedOptions, option => option.value);
    setSelectedCategories(selectedOptions);
  };

  // Prepare data for charts based on selected filter
  const prepareChartData = () => {
    if (!filterByCategory || selectedCategories.length === 0) {
      // No category filter or no categories selected, use normal data
      return financialData.map(period => ({
        name: formatPeriod(period.period),
        value: period[selectedMetric]
      }));
    }
    
    // When filtering by categories
    const filteredData = [];
    
    // Process each period
    categoryData.forEach((periodData, index) => {
      const periodName = formatPeriod(periodData.period);
      let totalValue = 0;
      
      // Sum the values of selected categories
      selectedCategories.forEach(categoryPath => {
        if (periodData.categories[categoryPath]) {
          totalValue += periodData.categories[categoryPath].value;
        }
      });
      
      filteredData.push({
        name: periodName,
        value: totalValue
      });
    });
    
    return filteredData;
  };

  // Prepare data for comparison chart with categories
  const prepareCategoryComparisonData = () => {
    if (!filterByCategory || selectedCategories.length === 0) {
      // No category filter, use regular comparison data
      return financialData.map(period => ({
        name: formatPeriod(period.period),
        receitaBruta: period.receitaBruta,
        custosDiretos: period.custosDiretos,
        lucroBruto: period.lucroBruto,
        resultadoFinal: period.resultadoFinal
      }));
    }
    
    // Create comparison data with selected categories
    return financialData.map((period, index) => {
      const periodCategories = categoryData[index].categories;
      const result = { name: formatPeriod(period.period) };
      
      selectedCategories.forEach(categoryPath => {
        // Get category name for display
        const category = availableCategories.find(c => c.id === categoryPath);
        const displayName = category ? category.name : categoryPath.split('.')[1];
        
        // Add category value to result
        result[displayName] = periodCategories[categoryPath]?.value || 0;
      });
      
      return result;
    });
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

  // Prepare summary table data with category filter
  const prepareSummaryTableData = () => {
    if (!filterByCategory || selectedCategories.length === 0) {
      // No category filter, return regular data
      return financialData;
    }
    
    // Create custom summary data with category totals
    return financialData.map((period, index) => {
      const periodCategories = categoryData[index].categories;
      let categoryTotal = 0;
      
      selectedCategories.forEach(categoryPath => {
        if (periodCategories[categoryPath]) {
          categoryTotal += periodCategories[categoryPath].value;
        }
      });
      
      return {
        ...period,
        categoryFilteredValue: categoryTotal
      };
    });
  };

  // Renderizar gráfico de linha - Evolução ao longo do tempo
  const renderLineChart = () => {
    const data = prepareChartData();
    const metricName = filterByCategory && selectedCategories.length > 0 
      ? "Categorias Selecionadas" 
      : (metrics.find(m => m.id === selectedMetric)?.name || selectedMetric);
    
    return (
      <div className="chart-container">
        <h3>Evolução de {metricName} por Período</h3>
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
            <Line 
              type="monotone" 
              dataKey="value" 
              name={metricName}
              stroke="#4caf50" 
              strokeWidth={2}
              activeDot={{ r: 8 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  };

  // Renderizar gráfico de barras - Comparação entre períodos
  const renderBarChart = () => {
    const data = prepareChartData();
    const metricName = filterByCategory && selectedCategories.length > 0 
      ? "Categorias Selecionadas" 
      : (metrics.find(m => m.id === selectedMetric)?.name || selectedMetric);
    
    return (
      <div className="chart-container">
        <h3>Comparação de {metricName} por Período</h3>
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
            <Bar 
              dataKey="value" 
              name={metricName}
              fill="#2196f3"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  // Renderizar gráfico de pizza - Distribuição por período
  const renderPieChart = () => {
    const data = prepareChartData();
    const metricName = filterByCategory && selectedCategories.length > 0 
      ? "Categorias Selecionadas" 
      : (metrics.find(m => m.id === selectedMetric)?.name || selectedMetric);
    
    // Calculate percentages
    const total = data.reduce((sum, item) => sum + Math.abs(item.value), 0);
    const dataWithPercent = data.map(item => ({
      ...item,
      percent: total ? ((Math.abs(item.value) / total) * 100).toFixed(1) : 0
    }));
    
    // Custom Label para o PieChart
    const renderCustomizedLabel = ({ 
      cx, cy, midAngle, innerRadius, outerRadius, percent, index, name
    }) => {
      const RADIAN = Math.PI / 180;
      const radius = outerRadius * 1.1;
      const x = cx + radius * Math.cos(-midAngle * RADIAN);
      const y = cy + radius * Math.sin(-midAngle * RADIAN);
      
      return (
        <text 
          x={x} 
          y={y} 
          fill={COLORS[index % COLORS.length]}
          textAnchor={x > cx ? 'start' : 'end'} 
          dominantBaseline="central"
          fontSize={12}
          fontWeight="bold"
        >
          {`${name}: ${dataWithPercent[index].percent}%`}
        </text>
      );
    };
    
    return (
      <div className="chart-container">
        <h3>Distribuição de {metricName} por Período</h3>
        <ResponsiveContainer width="100%" height={400}>
          <PieChart>
            <Pie
              data={dataWithPercent}
              cx="50%"
              cy="50%"
              labelLine={true}
              label={renderCustomizedLabel}
              outerRadius={150}
              fill="#8884d8"
              dataKey="value"
            >
              {dataWithPercent.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => formatCurrency(value)} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  };

  // Renderizar gráfico de barras - Múltiplas métricas por período
  const renderComparisonChart = () => {
    const data = prepareCategoryComparisonData();
    let dataFields = [];
    
    if (filterByCategory && selectedCategories.length > 0) {
      // When using category filter, get names of selected categories for the legend
      selectedCategories.forEach(categoryPath => {
        const category = availableCategories.find(c => c.id === categoryPath);
        if (category) {
          dataFields.push({
            dataKey: category.name,
            name: category.name,
            color: COLORS[dataFields.length % COLORS.length]
          });
        }
      });
    } else {
      // Default comparison fields
      dataFields = [
        { dataKey: "receitaBruta", name: "Receita Bruta", color: "#4caf50" },
        { dataKey: "custosDiretos", name: "Custos Diretos", color: "#f44336" },
        { dataKey: "lucroBruto", name: "Lucro Bruto", color: "#2196f3" },
        { dataKey: "resultadoFinal", name: "Resultado Final", color: "#ff9800" }
      ];
    }
    
    return (
      <div className="chart-container">
        <h3>
          {filterByCategory && selectedCategories.length > 0 
            ? "Comparação de Categorias por Período" 
            : "Comparação de Métricas por Período"}
        </h3>
        <ResponsiveContainer width="100%" height={500}>
          <BarChart
            data={data}
            margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis tickFormatter={(value) => formatCurrency(value)} />
            <Tooltip formatter={(value) => formatCurrency(value)} />
            <Legend />
            {dataFields.map((field, index) => (
              <Bar 
                key={field.dataKey}
                dataKey={field.dataKey} 
                name={field.name} 
                fill={field.color} 
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
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
                    className={`chart-button ${activeChart === 'line' ? 'active' : ''}`}
                    onClick={() => setActiveChart('line')}
                  >
                    <span className="chart-icon">📈</span> Linha
                  </button>
                  <button 
                    className={`chart-button ${activeChart === 'bar' ? 'active' : ''}`}
                    onClick={() => setActiveChart('bar')}
                  >
                    <span className="chart-icon">📊</span> Barras
                  </button>
                  <button 
                    className={`chart-button ${activeChart === 'pie' ? 'active' : ''}`}
                    onClick={() => setActiveChart('pie')}
                  >
                    <span className="chart-icon">🍩</span> Pizza
                  </button>
                  <button 
                    className={`chart-button ${activeChart === 'comparison' ? 'active' : ''}`}
                    onClick={() => setActiveChart('comparison')}
                  >
                    <span className="chart-icon">📋</span> Comparativo
                  </button>
                </div>
              </div>
              
              {/* Category Filter Controls */}
              <div className="filter-controls">
                <div className="filter-toggle">
                  <label>
                    <input 
                      type="checkbox" 
                      checked={filterByCategory}
                      onChange={toggleCategoryFilter}
                    />
                    Filtrar por categorias específicas
                  </label>
                </div>
                
                {filterByCategory && (
                  <div className="category-selector">
                    <label>Selecione as categorias:</label>
                    <select 
                      multiple 
                      value={selectedCategories}
                      onChange={handleCategorySelection}
                      className="category-multi-select"
                      size={5}
                    >
                      {availableCategories.map(category => (
                        <option key={category.id} value={category.id}>
                          {category.displayName}
                        </option>
                      ))}
                    </select>
                    <div className="category-help-text">
                      Pressione Ctrl (ou Cmd no Mac) para selecionar múltiplas categorias
                    </div>
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
              {activeChart === 'line' && renderLineChart()}
              {activeChart === 'bar' && renderBarChart()}
              {activeChart === 'pie' && renderPieChart()}
              {activeChart === 'comparison' && renderComparisonChart()}
            </div>
            
            <div className="periods-summary">
              <h3>Resumo dos Períodos</h3>
              <div className="summary-table-container">
                <table className="summary-table">
                  <thead>
                    <tr>
                      <th>Período</th>
                      {filterByCategory && selectedCategories.length > 0 ? (
                        <th>Total das Categorias Selecionadas</th>
                      ) : (
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
                          <td className={period.categoryFilteredValue >= 0 ? "amount-positive" : "amount-negative"}>
                            {formatCurrency(period.categoryFilteredValue)}
                          </td>
                        ) : (
                          <>
                            <td className="amount-positive">{formatCurrency(period.receitaBruta)}</td>
                            <td className="amount-negative">{formatCurrency(period.custosDiretos)}</td>
                            <td className={period.lucroBruto >= 0 ? "amount-positive" : "amount-negative"}>
                              {formatCurrency(period.lucroBruto)}
                            </td>
                            <td className={period.resultadoFinal >= 0 ? "amount-positive" : "amount-negative"}>
                              {formatCurrency(period.resultadoFinal)}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
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