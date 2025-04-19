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
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [error, setError] = useState("");
  const [financialData, setFinancialData] = useState({
    receitaBruta: 0,
    custosDiretos: 0,
    despesasOperacionais: 0,
    despesasTotais: 0, 
    lucroBruto: 0,
    resultadoFinal: 0,
    aportesValue: 0,              
    resultadoFinalComAportes: 0    
  });
  const [currentPeriod, setCurrentPeriod] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [periods, setPeriods] = useState([]);
  const [loadingFinancialData, setLoadingFinancialData] = useState(false);

  // Modificado: Inverter a lógica para que o comportamento padrão seja excluir aportes
  const [includeAportes, setIncludeAportes] = useState(false);
  
  // Estado para controlar o número de períodos a serem exibidos
  const [periodsToShow, setPeriodsToShow] = useState(6); // Valor padrão: 6
  
  const [periodsSummary, setPeriodsSummary] = useState([]);
  const [loadingPeriodsSummary, setLoadingPeriodsSummary] = useState(false);
  
  // Opções de períodos para o dropdown
  const periodOptions = [
    { value: 3, label: "3 meses" },
    { value: 6, label: "6 meses" },
    { value: 12, label: "12 meses" },
    { value: 24, label: "24 meses" },
    { value: 36, label: "36 meses" },
    { value: 0, label: "Tudo" }
  ];

  // Carregar dados financeiros do período selecionado
  const loadFinancialData = useCallback(async (period) => {
    try {
      setLoadingFinancialData(true);
      
      if (!auth.currentUser) return;
      
      // Resetar dados financeiros
      const initialData = {
        receitaBruta: 0,
        custosDiretos: 0,
        despesasOperacionais: 0,
        deducoesReceita: 0, 
        despesasTotais: 0,
        lucroBruto: 0,
        resultadoFinal: 0,
        outrasReceitas: 0,
        despesasSocios: 0,
        investimentos: 0,
        naoCategorizado: 0,
        totalTransactions: 0,
        totalWithoutOutrasReceitas: 0, // Nova propriedade para rastrear total sem outras receitas
        aportesValue: 0,
        resultadoFinalComAportes: 0
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
              let categoryPath = "";
              
              // Adicionar ao total geral da soma
              initialData.totalTransactions += transaction.amount;
              
              // Primeiro verificar se existe um mapeamento específico para esta transação
              if (specificMappings[transaction.id]) {
                const specificMapping = specificMappings[transaction.id];
                mainCategory = specificMapping.groupName;
                categoryPath = specificMapping.categoryPath || "";
                isCategorized = true;
              } 
              // Se não existir mapeamento específico, verificar mapeamento normal
              else if (categoryMappings[normalizedDescription]) {
                const mapping = categoryMappings[normalizedDescription];
                if (!mapping.isSpecificMapping) { // Não é um mapeamento específico para outra transação
                  mainCategory = mapping.groupName;
                  categoryPath = mapping.categoryPath || "";
                  isCategorized = true;
                }
              }
              // Verificar padrões específicos
              else if (!isCategorized) {
                const bankName = transaction.bankInfo?.org || "";
                let patternKey = null;
                
                // Verificar padrões para o banco Stone
                if (bankName.includes("Stone")) {
                  if (normalizedDescription.endsWith("maquininha")) {
                    patternKey = "padrao_stone_maquininha";
                  } 
                  else if (normalizedDescription.includes("ifood")) {
                    patternKey = "padrao_stone_ifood";
                  }
                  else if (normalizedDescription.endsWith("débito")) {
                    patternKey = "padrao_stone_debito";
                  }
                  else if (normalizedDescription.includes("crédito")) {
                    patternKey = "padrao_stone_credito";
                  }
                }
                // Verificar padrões para o banco SICOOB
                else if (bankName.includes("COOP DE CRED") || bankName.includes("SICOOB")) {
                  if (normalizedDescription.toUpperCase().includes("IFOOD")) {
                    patternKey = "padrao_sicoob_ifood";
                  }
                }
                
                // Se encontrou um padrão e existe mapeamento para esse padrão
                if (patternKey && categoryMappings[patternKey]) {
                  const mapping = categoryMappings[patternKey];
                  mainCategory = mapping.groupName;
                  categoryPath = mapping.categoryPath || "";
                  isCategorized = true;
                  console.log(`Dashboard: Transação "${normalizedDescription}" categorizada pelo padrão ${patternKey}`);
                }
              }
              
              // Check if this is an "aporte de sócio"
              if ((categoryPath && categoryPath.toLowerCase().includes('aporte')) || 
                  normalizedDescription.toLowerCase().includes('aporte')) {
                initialData.aportesValue += transaction.amount;
              }
              
              // Categorizar transação com base no mapeamento
              if (isCategorized) {
                if (mainCategory === "RECEITA") {
                  initialData.receitaBruta += transaction.amount;
                } else if (mainCategory === "(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)") {
                  initialData.custosDiretos += transaction.amount;
                } else if (mainCategory === "(-) DESPESAS OPERACIONAIS") {
                  initialData.despesasOperacionais += transaction.amount;
                } else if (mainCategory === "(-) DEDUÇÕES DA RECEITA") {
                  initialData.deducoesReceita += transaction.amount;
                } else if (mainCategory === "(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS") {
                  initialData.outrasReceitas += transaction.amount;
                  // IMPORTANTE: Não adicionar à soma para o cálculo do totalWithoutOutrasReceitas
                  continue;
                } else if (mainCategory === "(-) DESPESAS COM SÓCIOS") {
                  initialData.despesasSocios += transaction.amount;
                } else if (mainCategory === "(-) INVESTIMENTOS") {
                  initialData.investimentos += transaction.amount;
                }
                
                // Adicionar ao total sem OUTRAS RECEITAS
                initialData.totalWithoutOutrasReceitas += transaction.amount;
              } else {
                // Transação não categorizada - incluir no valor não categorizado
                initialData.naoCategorizado += transaction.amount;
                // Também adicionar ao total sem OUTRAS RECEITAS
                initialData.totalWithoutOutrasReceitas += transaction.amount;
              }
            }
          } catch (error) {
            console.error(`Erro ao processar arquivo OFX ${fileData.fileName}:`, error);
          }
        }
      }
      
      // 2. Buscar e processar entradas de dinheiro para o período
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
              
              // Adicionar ao total geral da soma
              initialData.totalTransactions += entry.amount;
              
              // Check if this is an "aporte de sócio"
              if ((entry.categoryPath && entry.categoryPath.toLowerCase().includes('aporte')) || 
                  (entry.description && entry.description.toLowerCase().includes('aporte'))) {
                initialData.aportesValue += entry.amount;
              }
              
              // Categorizar com base no grupo principal
              if (mainCategory === "RECEITA") {
                initialData.receitaBruta += entry.amount;
                initialData.totalWithoutOutrasReceitas += entry.amount;
              } else if (mainCategory === "(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)") {
                initialData.custosDiretos += entry.amount;
                initialData.totalWithoutOutrasReceitas += entry.amount;
              } else if (mainCategory === "(-) DESPESAS OPERACIONAIS") {
                initialData.despesasOperacionais += entry.amount;
                initialData.totalWithoutOutrasReceitas += entry.amount;
              } else if (mainCategory === "(-) DEDUÇÕES DA RECEITA") {
                initialData.deducoesReceita += entry.amount;
                initialData.totalWithoutOutrasReceitas += entry.amount;
              } else if (mainCategory === "(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS") {
                initialData.outrasReceitas += entry.amount;
                // IMPORTANTE: Não adicionar ao totalWithoutOutrasReceitas
              } else if (mainCategory === "(-) DESPESAS COM SÓCIOS") {
                initialData.despesasSocios += entry.amount;
                initialData.totalWithoutOutrasReceitas += entry.amount;
              } else if (mainCategory === "(-) INVESTIMENTOS") {
                initialData.investimentos += entry.amount;
                initialData.totalWithoutOutrasReceitas += entry.amount;
              }
              
              console.log(`Entrada de dinheiro processada no Dashboard: ${formatCurrency(entry.amount)} em ${mainCategory}`);
            }
          }
        });
      } catch (error) {
        console.error("Erro ao carregar entradas de dinheiro:", error);
      }
      
      // Calcular despesas totais somando as categorias específicas e não categorizadas
      initialData.despesasTotais = initialData.deducoesReceita + initialData.custosDiretos + 
                                  initialData.despesasOperacionais + initialData.naoCategorizado;
      
      // Calcular valores derivados 
      initialData.lucroBruto = initialData.receitaBruta + initialData.custosDiretos;
      const resultadoOperacional = initialData.lucroBruto + initialData.despesasOperacionais;
      const resultadoAntesIR = resultadoOperacional + initialData.despesasSocios;
      
      // MODIFICADO: O resultado final agora exclui as OUTRAS RECEITAS por padrão
      initialData.resultadoFinal = initialData.totalWithoutOutrasReceitas;
      
      // MODIFICADO: Resultado com aportes
      initialData.resultadoFinalComAportes = initialData.resultadoFinal + initialData.outrasReceitas;
      
      // Adicionar log para depuração
      console.log("Valores financeiros calculados:", {
        periodo: period,
        receitaBruta: initialData.receitaBruta,
        custosDiretos: initialData.custosDiretos,
        despesasOperacionais: initialData.despesasOperacionais,
        despesasTotais: initialData.despesasTotais,
        lucroBruto: initialData.lucroBruto,
        outrasReceitas: initialData.outrasReceitas,
        resultadoOperacional: resultadoOperacional,
        despesasSocios: initialData.despesasSocios,
        resultadoAntesIR: resultadoAntesIR,
        investimentos: initialData.investimentos,
        naoCategorizado: initialData.naoCategorizado,
        resultadoFinal: initialData.resultadoFinal,
        resultadoFinalComAportes: initialData.resultadoFinalComAportes,
        aportesValue: initialData.aportesValue,
        totalTransactions: initialData.totalTransactions,
        totalWithoutOutrasReceitas: initialData.totalWithoutOutrasReceitas,
      });
      
      // Calcular percentuais
      if (initialData.receitaBruta > 0) {
        initialData.custosDiretosPercent = (Math.abs(initialData.custosDiretos) / initialData.receitaBruta) * 100;
        initialData.despesasTotaisPercent = (Math.abs(initialData.despesasTotais) / initialData.receitaBruta) * 100;
        initialData.lucroBrutoPercent = (initialData.lucroBruto / initialData.receitaBruta) * 100;
        initialData.resultadoFinalPercent = (initialData.resultadoFinal / initialData.receitaBruta) * 100;
        initialData.despesasOperacionaisPercent = (Math.abs(initialData.despesasOperacionais) / initialData.receitaBruta) * 100;
      } else {
        initialData.custosDiretosPercent = 0;
        initialData.despesasTotaisPercent = 0;
        initialData.lucroBrutoPercent = 0;
        initialData.resultadoFinalPercent = 0;
        initialData.despesasOperacionaisPercent = 0;
      }
      
      setFinancialData(initialData);
    } catch (error) {
      console.error("Erro ao carregar dados financeiros:", error);
      setError("Não foi possível carregar os dados financeiros para o período selecionado.");
    } finally {
      setLoadingFinancialData(false);
    }
  }, []);

  // MODIFICADO: Function to load period summary with variable number of periods
  const loadPeriodsSummary = useCallback(async () => {
    try {
      setLoadingPeriodsSummary(true);
      
      if (!auth.currentUser || periods.length === 0) return;
      
      const summaryResults = [];
      
      // MODIFICADO: Aplicar o filtro de quantidade de períodos
      // Se periodsToShow for 0, mostrar todos os períodos
      const periodsToProcess = periodsToShow === 0 
        ? [...periods] 
        : [...periods].slice(0, Math.min(periodsToShow, periods.length));
      
      for (const period of periodsToProcess) {
        // Function to calculate financial data for a specific period
        // Similar to loadFinancialData but returns data instead of setting state
        
        const initialData = {
          period: period.value,
          periodLabel: period.label,
          receitaBruta: 0,
          custosDiretos: 0,
          despesasOperacionais: 0,
          lucroBruto: 0,
          outrasReceitas: 0,
          despesasSocios: 0,
          investimentos: 0,
          naoCategorizado: 0,
          resultadoFinal: 0,
          resultadoFinalComAportes: 0,
          aportesValue: 0,
          totalTransactions: 0,
          totalWithoutOutrasReceitas: 0
        };
        
        // Get category mappings
        const categoryMappingsDoc = await getDoc(doc(db, "categoryMappings", auth.currentUser.uid));
        const categoryMappings = categoryMappingsDoc.exists() ? categoryMappingsDoc.data().mappings || {} : {};
        
        // Identify specific mappings by transaction ID
        const specificMappings = {};
        Object.entries(categoryMappings).forEach(([key, mapping]) => {
          if (mapping.isSpecificMapping && mapping.transactionId) {
            specificMappings[mapping.transactionId] = mapping;
          }
        });
        
        // 1. Get OFX files for the period
        const ofxFilesQuery = query(
          collection(db, "ofxFiles"),
          where("userId", "==", auth.currentUser.uid),
          where("period", "==", period.value)
        );
        
        const ofxFilesSnapshot = await getDocs(ofxFilesQuery);
        
        // Process each OFX file
        for (const fileDoc of ofxFilesSnapshot.docs) {
          const fileData = fileDoc.data();
          
          if (fileData.filePath) {
            try {
              const storageRef = ref(storage, fileData.filePath);
              const blob = await getBlob(storageRef);
              const fileContent = await blob.text();
              const parseResult = parseOFXContent(fileContent);
              const transactions = parseResult.transactions;
              
              // Process each transaction
              for (const transaction of transactions) {
                const normalizedDescription = transaction.description.trim().toLowerCase();
                let mainCategory = null;
                let isCategorized = false;
                let isAporte = false;
                let categoryPath = "";
                
                // Adicionar à soma total das transações
                initialData.totalTransactions += transaction.amount;
                
                // Check if there's a specific mapping for this transaction
                if (specificMappings[transaction.id]) {
                  const specificMapping = specificMappings[transaction.id];
                  mainCategory = specificMapping.groupName;
                  categoryPath = specificMapping.categoryPath || "";
                  isCategorized = true;
                } 
                // If not, check for a normal mapping
                else if (categoryMappings[normalizedDescription]) {
                  const mapping = categoryMappings[normalizedDescription];
                  if (!mapping.isSpecificMapping) {
                    mainCategory = mapping.groupName;
                    categoryPath = mapping.categoryPath || "";
                    isCategorized = true;
                  }
                }
                // Verificar padrões específicos
                else if (!isCategorized) {
                  const bankName = transaction.bankInfo?.org || "";
                  let patternKey = null;
                  
                  // Verificar padrões para o banco Stone
                  if (bankName.includes("Stone")) {
                    if (normalizedDescription.endsWith("maquininha")) {
                      patternKey = "padrao_stone_maquininha";
                    } 
                    else if (normalizedDescription.includes("ifood")) {
                      patternKey = "padrao_stone_ifood";
                    }
                    else if (normalizedDescription.endsWith("débito")) {
                      patternKey = "padrao_stone_debito";
                    }
                    else if (normalizedDescription.includes("crédito")) {
                      patternKey = "padrao_stone_credito";
                    }
                  }
                  // Verificar padrões para o banco SICOOB
                  else if (bankName.includes("COOP DE CRED") || bankName.includes("SICOOB")) {
                    if (normalizedDescription.toUpperCase().includes("IFOOD")) {
                      patternKey = "padrao_sicoob_ifood";
                    }
                  }
                  
                  // Se encontrou um padrão e existe mapeamento para esse padrão
                  if (patternKey && categoryMappings[patternKey]) {
                    const mapping = categoryMappings[patternKey];
                    mainCategory = mapping.groupName;
                    categoryPath = mapping.categoryPath || "";
                    isCategorized = true;
                    console.log(`PeriodsSummary: Transação "${normalizedDescription}" categorizada pelo padrão ${patternKey}`);
                  }
                }
                
                // Check if this is an "aporte de sócio"
                if (categoryPath.toLowerCase().includes('aporte') || 
                    normalizedDescription.toLowerCase().includes('aporte')) {
                  isAporte = true;
                  initialData.aportesValue += transaction.amount;
                }
                
                // Categorize transaction based on mapping
                if (isCategorized) {
                  if (mainCategory === "RECEITA") {
                    initialData.receitaBruta += transaction.amount;
                    initialData.totalWithoutOutrasReceitas += transaction.amount;
                  } else if (mainCategory === "(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)") {
                    initialData.custosDiretos += transaction.amount;
                    initialData.totalWithoutOutrasReceitas += transaction.amount;
                  } else if (mainCategory === "(-) DESPESAS OPERACIONAIS") {
                    initialData.despesasOperacionais += transaction.amount;
                    initialData.totalWithoutOutrasReceitas += transaction.amount;
                  } else if (mainCategory === "(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS") {
                    initialData.outrasReceitas += transaction.amount;
                    // Não adicionar ao totalWithoutOutrasReceitas
                  } else if (mainCategory === "(-) DESPESAS COM SÓCIOS") {
                    initialData.despesasSocios += transaction.amount;
                    initialData.totalWithoutOutrasReceitas += transaction.amount;
                  } else if (mainCategory === "(-) INVESTIMENTOS") {
                    initialData.investimentos += transaction.amount;
                    initialData.totalWithoutOutrasReceitas += transaction.amount;
                  }
                } else {
                  // Uncategorized transaction
                  initialData.naoCategorizado += transaction.amount;
                  initialData.totalWithoutOutrasReceitas += transaction.amount;
                }
              }
            } catch (error) {
              console.error(`Erro ao processar arquivo OFX ${fileData.fileName}:`, error);
            }
          }
        }
        
        // 2. Process cash entries for the period
        try {
          const cashEntriesQuery = query(
            collection(db, "cashEntries"),
            where("userId", "==", auth.currentUser.uid),
            where("period", "==", period.value)
          );
          
          const cashEntriesSnapshot = await getDocs(cashEntriesQuery);
          
          // Process each cash entry
          cashEntriesSnapshot.forEach(doc => {
            const entry = doc.data();
            
            // Check if entry has a category and amount
            if (entry.categoryPath && typeof entry.amount === 'number') {
              const pathParts = entry.categoryPath.split('.');
              
              if (pathParts.length >= 2) {
                const mainCategory = pathParts[0];
                const categoryName = pathParts[1];
                
                // Adicionar à soma total das transações
                initialData.totalTransactions += entry.amount;
                
                // Check if this is an "aporte de sócio"
                if (entry.categoryPath.toLowerCase().includes('aporte') || 
                    (entry.description && entry.description.toLowerCase().includes('aporte')) ||
                    categoryName.toLowerCase().includes('aporte')) {
                  initialData.aportesValue += entry.amount;
                }
                
                // Categorize based on main category
                if (mainCategory === "RECEITA") {
                  initialData.receitaBruta += entry.amount;
                  initialData.totalWithoutOutrasReceitas += entry.amount;
                } else if (mainCategory === "(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)") {
                  initialData.custosDiretos += entry.amount;
                  initialData.totalWithoutOutrasReceitas += entry.amount;
                } else if (mainCategory === "(-) DESPESAS OPERACIONAIS") {
                  initialData.despesasOperacionais += entry.amount;
                  initialData.totalWithoutOutrasReceitas += entry.amount;
                } else if (mainCategory === "(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS") {
                  initialData.outrasReceitas += entry.amount;
                  // Não adicionar ao totalWithoutOutrasReceitas
                } else if (mainCategory === "(-) DESPESAS COM SÓCIOS") {
                  initialData.despesasSocios += entry.amount;
                  initialData.totalWithoutOutrasReceitas += entry.amount;
                } else if (mainCategory === "(-) INVESTIMENTOS") {
                  initialData.investimentos += entry.amount;
                  initialData.totalWithoutOutrasReceitas += entry.amount;
                }
              }
            }
          });
        } catch (error) {
          console.error(`Erro ao processar entradas de dinheiro para o período ${period.value}:`, error);
        }
        
        // MODIFICADO: Resultado final agora é sem OUTRAS RECEITAS por padrão
        initialData.resultadoFinal = initialData.totalWithoutOutrasReceitas;
        
        // MODIFICADO: Resultado com todas as receitas
        initialData.resultadoFinalComAportes = initialData.resultadoFinal + initialData.outrasReceitas;
        
        // Calculate total costs (all expenses combined)
        initialData.custosTotal = Math.abs(initialData.custosDiretos) + 
                                  Math.abs(initialData.despesasOperacionais) + 
                                  Math.abs(initialData.despesasSocios) + 
                                  Math.abs(initialData.investimentos);
        
        // Opcionalmente, atualizar o valor de lucro bruto para display
        initialData.lucroBruto = initialData.receitaBruta + initialData.custosDiretos;
        
        summaryResults.push(initialData);
      }
      
      setPeriodsSummary(summaryResults);
    } catch (error) {
      console.error("Erro ao carregar resumo de períodos:", error);
      setError("Não foi possível carregar o resumo de períodos.");
    } finally {
      setLoadingPeriodsSummary(false);
    }
  }, [periods, periodsToShow]); // MODIFICADO: Adicionado periodsToShow como dependência

  // Buscar períodos disponíveis
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
  }, [loadFinancialData]);

  useEffect(() => {
    const fetchUserData = async () => {
      if (auth.currentUser) {
        setUser(auth.currentUser);
        
        try {
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

  // Load periods summary when periods are available
  useEffect(() => {
    if (periods.length > 0) {
      loadPeriodsSummary();
    }
  }, [periods, periodsToShow, loadPeriodsSummary]); // MODIFICADO: Adicionado periodsToShow como dependência

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

  // NOVO: Função para tratar mudança na quantidade de períodos a mostrar
  const handlePeriodsToShowChange = (event) => {
    const value = parseInt(event.target.value);
    setPeriodsToShow(value);
    
    // Opcional: Salvar preferência no localStorage
    localStorage.setItem('periodsToShow', value.toString());
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
      <div className="card-container" style={{marginBottom: "20px"}}>
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

        {/* Card combinado de despesas totais que substitui os dois cards anteriores */}
        <div className="fin-card" style={{borderLeftColor: '#36b9cc'}}>
          <div className="fin-card-title">DESPESAS TOTAIS</div>
          <div className="fin-card-value">
            {loadingFinancialData ? (
              <span className="loading-text">Carregando...</span>
            ) : (
              formatCurrency(Math.abs(financialData.despesasTotais))
            )}
          </div>
          <div className="fin-card-description">Deduções + Custos + Despesas + Não categorizadas</div>
          <div className="fin-card-footer">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ 
                  width: `${financialData.despesasTotaisPercent}%`, 
                  backgroundColor: '#36b9cc' 
                }}
              ></div>
            </div>
            <div className="progress-text">
              {loadingFinancialData ? 
                "Calculando..." : 
                `${Math.round(financialData.despesasTotaisPercent || 0)}% das receitas`
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
              formatCurrency(includeAportes ? financialData.resultadoFinalComAportes : financialData.resultadoFinal)
            )}
          </div>
          <div className="fin-card-description">
            Resultado líquido do período {includeAportes && "(com aportes)"}
          </div>
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

      {/* Period Summary Section */}
      <div className="period-summary-section">
        <div className="section-header">
          <h2>Evolução dos Resultados</h2>
          <div className="summary-controls">
            {/* NOVO: Seletor para quantidade de períodos */}
            <div className="periods-to-show-dropdown">
              <label htmlFor="periods-to-show-select">Mostrar: </label>
              <select
                id="periods-to-show-select"
                value={periodsToShow}
                onChange={handlePeriodsToShowChange}
                disabled={loadingPeriodsSummary}
                className="period-select"
              >
                {periodOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="exclude-aportes-toggle">
              <label>
                <input 
                  type="checkbox" 
                  checked={includeAportes}
                  onChange={() => setIncludeAportes(!includeAportes)}
                />
                Mostrar aportes de sócios ao resultado final
              </label>
              {includeAportes && <span className="filter-active">Filtro ativo</span>}
            </div>
          </div>
        </div>

        {loadingPeriodsSummary ? (
          <div className="summary-loading">
            <div className="loading-spinner"></div>
            <p>Carregando resumo de períodos...</p>
          </div>
        ) : periodsSummary.length === 0 ? (
          <div className="no-summary-data">
            <p>Não há dados suficientes para mostrar a evolução dos resultados.</p>
          </div>
        ) : (
          <>
            {/* Summary Cards View */}
            <div className="summary-cards-container">
              {periodsSummary.map((period, index) => {
                // Determine if the result is positive based on includeAportes setting
                const isPositiveResult = includeAportes ? 
                  period.resultadoFinalComAportes >= 0 : 
                  period.resultadoFinal >= 0;
                  
                return (
                  <div 
                    key={index} 
                    className={`summary-period-card ${isPositiveResult ? 'result-positive' : 'result-negative'}`}
                  >
                    <div className="period-card-header">
                      <span className="period-name">{period.periodLabel}</span>
                      <span className={`period-result ${
                        includeAportes ? 
                          (period.resultadoFinalComAportes >= 0 ? 'positive' : 'negative') : 
                          (period.resultadoFinal >= 0 ? 'positive' : 'negative')
                      }`}>
                        {formatCurrency(includeAportes ? period.resultadoFinalComAportes : period.resultadoFinal)}
                      </span>
                    </div>
                    
                    <div className="period-card-details">
                      <div className="period-metric">
                        <span className="metric-label">Receita</span>
                        <span className="metric-value positive">{formatCurrency(period.receitaBruta)}</span>
                      </div>
                      <div className="period-metric">
                        <span className="metric-label">Custos Totais</span>
                        <span className="metric-value negative">{formatCurrency(period.custosTotal)}</span>
                      </div>
                      <div className="period-metric">
                        <span className="metric-label">Lucro Bruto</span>
                        <span className={`metric-value ${period.lucroBruto >= 0 ? 'positive' : 'negative'}`}>
                          {formatCurrency(period.lucroBruto)}
                        </span>
                      </div>
                      
                      {includeAportes && period.outrasReceitas > 0 && (
                        <div className="period-metric aportes">
                          <span className="metric-label">Aportes/Outras Receitas</span>
                          <span className="metric-value">{formatCurrency(period.outrasReceitas)}</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="period-card-chart">
                      <div className="micro-chart">
                        <div className="chart-bar">
                          <div 
                            className="chart-fill" 
                            style={{ 
                              width: `${Math.min(100, Math.max(0, ((period.receitaBruta - period.custosTotal) / period.receitaBruta) * 100 || 0))}%`,
                              backgroundColor: (period.receitaBruta - period.custosTotal) >= 0 ? '#4caf50' : '#f44336'
                            }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Summary Table - MODIFICADO: Adicionada coluna de Aportes quando includeAportes for true */}
            <div className="summary-table-container">
              <table className="summary-table">
                <thead>
                  <tr>
                    <th>Período</th>
                    <th>Receita</th>
                    <th>Custos Totais</th>
                    <th>Lucro Bruto</th>
                    {includeAportes && <th>Aportes</th>}
                    <th>Resultado Final</th>
                  </tr>
                </thead>
                <tbody>
                  {periodsSummary.map((period, index) => (
                    <tr key={index}>
                      <td>{period.periodLabel}</td>
                      <td className="amount-positive">{formatCurrency(period.receitaBruta)}</td>
                      <td className="amount-negative">{formatCurrency(period.custosTotal)}</td>
                      <td className={period.lucroBruto >= 0 ? "amount-positive" : "amount-negative"}>
                        {formatCurrency(period.lucroBruto)}
                      </td>
                      {includeAportes && 
                        <td className="amount-positive">{formatCurrency(period.outrasReceitas)}</td>
                      }
                      <td className={
                        includeAportes ? 
                          (period.resultadoFinalComAportes >= 0 ? "amount-positive" : "amount-negative") : 
                          (period.resultadoFinal >= 0 ? "amount-positive" : "amount-negative")
                      }>
                        {formatCurrency(includeAportes ? period.resultadoFinalComAportes : period.resultadoFinal)}
                      </td>
                    </tr>
                  ))}
                  
                  {/* Totals row - MODIFICADO: Adicionada célula para total de aportes */}
                  <tr className="total-row">
                    <td><strong>TOTAL</strong></td>
                    <td className="amount-positive">
                      {formatCurrency(periodsSummary.reduce((sum, period) => sum + period.receitaBruta, 0))}
                    </td>
                    <td className="amount-negative">
                      {formatCurrency(periodsSummary.reduce((sum, period) => sum + period.custosTotal, 0))}
                    </td>
                    <td className={periodsSummary.reduce((sum, period) => sum + period.lucroBruto, 0) >= 0 ? "amount-positive" : "amount-negative"}>
                      {formatCurrency(periodsSummary.reduce((sum, period) => sum + period.lucroBruto, 0))}
                    </td>
                    {includeAportes && 
                      <td className="amount-positive">
                        {formatCurrency(periodsSummary.reduce((sum, period) => sum + period.outrasReceitas, 0))}
                      </td>
                    }
                    <td className={
                      includeAportes ?
                        (periodsSummary.reduce((sum, period) => sum + period.resultadoFinalComAportes, 0) >= 0 ? "amount-positive" : "amount-negative") :
                        (periodsSummary.reduce((sum, period) => sum + period.resultadoFinal, 0) >= 0 ? "amount-positive" : "amount-negative")
                    }>
                      {formatCurrency(
                        includeAportes ?
                          periodsSummary.reduce((sum, period) => sum + period.resultadoFinalComAportes, 0) :
                          periodsSummary.reduce((sum, period) => sum + period.resultadoFinal, 0)
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

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