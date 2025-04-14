// src/components/Charts/Charts.js
import React, { useState, useEffect } from "react";
import { auth, db, storage } from "../../firebase/config";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc,
  getDoc,
  orderBy
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

  const COLORS = ['#4caf50', '#ff9800', '#2196f3', '#f44336', '#9c27b0', '#00acc1'];
  
  // Métricas disponíveis para visualização
  const metrics = [
    { id: "receitaBruta", name: "Receita Bruta" },
    { id: "custosDiretos", name: "Custos Diretos" },
    { id: "lucroBruto", name: "Lucro Bruto" },
    { id: "resultadoFinal", name: "Resultado Final" },
  ];

  // Carregar usuário e períodos disponíveis
  useEffect(() => {
    const loadUserAndPeriods = async () => {
      try {
        setLoading(true);
        
        if (auth.currentUser) {
          setUser(auth.currentUser);
          await loadPeriodsData();
        }
      } catch (error) {
        console.error("Erro ao carregar dados:", error);
        setError("Não foi possível carregar os dados. Tente novamente mais tarde.");
      } finally {
        setLoading(false);
      }
    };
    
    loadUserAndPeriods();
  }, []);

  // Carregar e processar dados financeiros de todos os períodos
  const loadPeriodsData = async () => {
    try {
      if (!auth.currentUser) return;
      
      // Verificar se temos períodos salvos no localStorage
      const savedPeriod = localStorage.getItem('selectedPeriod');
      
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
        setFinancialData(financialResults);
      }
    } catch (error) {
      console.error("Erro ao carregar períodos:", error);
      setError("Não foi possível carregar os períodos disponíveis.");
    }
  };

  // Função para carregar dados financeiros de todos os períodos
  const loadAllFinancialData = async (periodsArray) => {
    const results = [];
    
    for (const period of periodsArray) {
      // Simulando call para extrair dados financeiros de cada período
      // Em um caso real, você faria uma consulta ao Firestore por período
      const periodData = await calculateFinancialDataForPeriod(period.value, period.label);
      results.push(periodData);
    }
    
    return results;
  };

  // Função para calcular dados financeiros de um período específico
  const calculateFinancialDataForPeriod = async (period, periodLabel) => {
    try {
      // Inicializar valores financeiros
      let totalValue = 0;
      let receitaBruta = 0;
      let custosDiretos = 0;
      let despesasOperacionais = 0;
      let outrasReceitas = 0;
      let despesasSocios = 0;
      let investimentos = 0;
      let naoCategorizado = 0;
      
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
            period,
            periodLabel,
            receitaBruta: 0,
            custosDiretos: 0,
            lucroBruto: 0,
            despesasOperacionais: 0,
            resultadoFinal: 0
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
          transactions.forEach(transaction => {
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
              if (!mapping.isSpecificMapping) {
                mainCategory = mapping.groupName;
                isCategorized = true;
              }
            }
            
            // Adicionar ao total geral
            totalValue += transaction.amount;
            
            // Categorizar com base no grupo principal
            if (isCategorized) {
              if (mainCategory === "RECEITA") {
                receitaBruta += transaction.amount;
              } 
              else if (mainCategory === "(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)") {
                custosDiretos += Math.abs(transaction.amount);
              } 
              else if (mainCategory === "(-) DESPESAS OPERACIONAIS") {
                despesasOperacionais += Math.abs(transaction.amount);
              }
              else if (mainCategory === "(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS") {
                outrasReceitas += transaction.amount;
              }
              else if (mainCategory === "(-) DESPESAS COM SÓCIOS") {
                despesasSocios += Math.abs(transaction.amount);
              }
              else if (mainCategory === "(-) INVESTIMENTOS") {
                investimentos += Math.abs(transaction.amount);
              }
            } else {
              // Se não for categorizada, considerar como não categorizado
              naoCategorizado += transaction.amount;
            }
          });
        } catch (error) {
          console.error(`Erro ao processar arquivo OFX ${fileData.fileName}:`, error);
        }
      }

      // 3. NOVO: Buscar e processar entradas de dinheiro para o período
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
              
              // Adicionar ao total geral
              totalValue += entry.amount;
              
              // Categorizar com base no grupo principal
              if (mainCategory === "RECEITA") {
                receitaBruta += entry.amount;
              } 
              else if (mainCategory === "(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)") {
                custosDiretos += Math.abs(entry.amount);
              } 
              else if (mainCategory === "(-) DESPESAS OPERACIONAIS") {
                despesasOperacionais += Math.abs(entry.amount);
              }
              else if (mainCategory === "(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS") {
                outrasReceitas += entry.amount;
              }
              else if (mainCategory === "(-) DESPESAS COM SÓCIOS") {
                despesasSocios += Math.abs(entry.amount);
              }
              else if (mainCategory === "(-) INVESTIMENTOS") {
                investimentos += Math.abs(entry.amount);
              }
              
              console.log(`Entrada de dinheiro processada no Charts para período ${periodLabel}: ${formatCurrency(entry.amount)} em ${mainCategory}`);
            }
          }
        });
      } catch (error) {
        console.error(`Erro ao processar entradas de dinheiro para o período ${period}:`, error);
      }
      
      // Calcular valores derivados usando a mesma lógica do DRE
      const lucroBruto = receitaBruta - custosDiretos;
      const resultadoOperacional = lucroBruto - despesasOperacionais + outrasReceitas;
      const resultadoAntesIR = resultadoOperacional - despesasSocios;
      // Incluir o valor das transações não categorizadas como no DRE
      const resultadoFinal = resultadoAntesIR - investimentos + naoCategorizado;
      
      // Log para debug
      console.log(`Período ${periodLabel} - Valores:`, {
        receitaBruta,
        custosDiretos,
        lucroBruto,
        despesasOperacionais,
        outrasReceitas,
        resultadoOperacional,
        despesasSocios,
        resultadoAntesIR,
        investimentos,
        naoCategorizado,
        resultadoFinal
      });
      
      return {
        period,
        periodLabel,
        receitaBruta,
        custosDiretos,
        lucroBruto,
        despesasOperacionais,
        outrasReceitas,
        resultadoOperacional,
        despesasSocios,
        resultadoAntesIR,
        investimentos,
        naoCategorizado,
        resultadoFinal
      };
      
    } catch (error) {
      console.error(`Erro ao calcular dados para o período ${period}:`, error);
      return {
        period,
        periodLabel,
        receitaBruta: 0,
        custosDiretos: 0,
        lucroBruto: 0,
        despesasOperacionais: 0,
        resultadoFinal: 0
      };
    }
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

  // Preparar dados para o gráfico de comparação de métricas
  const prepareComparisonData = () => {
    return financialData.map(period => ({
      name: formatPeriod(period.period),
      receitaBruta: period.receitaBruta,
      custosDiretos: period.custosDiretos,
      lucroBruto: period.lucroBruto,
      resultadoFinal: period.resultadoFinal
    }));
  };

  // Preparar dados para o gráfico de evolução de uma métrica
  const prepareEvolutionData = () => {
    return financialData.map(period => ({
      name: formatPeriod(period.period),
      value: period[selectedMetric]
    }));
  };

  // Preparar dados para o gráfico de pizza
  const preparePieData = () => {
    let total = 0;
    const data = financialData.map(period => {
      total += Math.abs(period[selectedMetric]);
      return {
        name: formatPeriod(period.period),
        value: Math.abs(period[selectedMetric]) // Usar valor absoluto para o gráfico de pizza
      };
    });
    
    // Calcular percentuais
    return data.map(item => ({
      ...item,
      percent: ((item.value / total) * 100).toFixed(1)
    }));
  };

  // Renderizar gráfico de linha - Evolução ao longo do tempo
  const renderLineChart = () => {
    const data = prepareEvolutionData();
    const metricName = metrics.find(m => m.id === selectedMetric)?.name || selectedMetric;
    
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
    const data = prepareEvolutionData();
    const metricName = metrics.find(m => m.id === selectedMetric)?.name || selectedMetric;
    
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
    const data = preparePieData();
    const metricName = metrics.find(m => m.id === selectedMetric)?.name || selectedMetric;
    
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
          {`${name}: ${percent}%`}
        </text>
      );
    };
    
    return (
      <div className="chart-container">
        <h3>Distribuição de {metricName} por Período</h3>
        <ResponsiveContainer width="100%" height={400}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={true}
              label={renderCustomizedLabel}
              outerRadius={150}
              fill="#8884d8"
              dataKey="value"
            >
              {data.map((entry, index) => (
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
    const data = prepareComparisonData();
    
    return (
      <div className="chart-container">
        <h3>Comparação de Métricas por Período</h3>
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
            <Bar dataKey="receitaBruta" name="Receita Bruta" fill="#4caf50" />
            <Bar dataKey="custosDiretos" name="Custos Diretos" fill="#f44336" />
            <Bar dataKey="lucroBruto" name="Lucro Bruto" fill="#2196f3" />
            <Bar dataKey="resultadoFinal" name="Resultado Final" fill="#ff9800" />
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
              
              {activeChart !== 'comparison' && (
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
                      <th>Receita Bruta</th>
                      <th>Custos Diretos</th>
                      <th>Lucro Bruto</th>
                      <th>Resultado Final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {financialData.map((period, index) => (
                      <tr key={index}>
                        <td>{formatPeriod(period.period)}</td>
                        <td className="amount-positive">{formatCurrency(period.receitaBruta)}</td>
                        <td className="amount-negative">{formatCurrency(period.custosDiretos)}</td>
                        <td className={period.lucroBruto >= 0 ? "amount-positive" : "amount-negative"}>
                          {formatCurrency(period.lucroBruto)}
                        </td>
                        <td className={period.resultadoFinal >= 0 ? "amount-positive" : "amount-negative"}>
                          {formatCurrency(period.resultadoFinal)}
                        </td>
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