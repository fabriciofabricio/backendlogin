// src/components/Auth/CategorySelection.js
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../../firebase/config";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import "./CategorySelection.css";

const CategorySelection = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState({});
  const [currentStep, setCurrentStep] = useState(0);
  // Variável de estado para o modelo de negócio
  const [businessModel, setBusinessModel] = useState("");

  // Obter a estrutura de categorias financeiras com base no modelo de negócio
  const getFinancialCategories = () => {
    const baseCategories = {
      "1. RECEITA": {
        order: 1,
        displayName: "RECEITA",
        items: [
          "Dinheiro",
          "Cheque",
          "Boleto",
          "Transferência",
          "Cartão de Crédito",
          "Cartão de Débito",
          "Pix",
          "TED",
          "VR",
          "Ifood",
          "Outras Entradas"
        ]
      },
      "2. (-) DEDUÇÕES DA RECEITA": {
        order: 2,
        displayName: "(-) DEDUÇÕES DA RECEITA",
        items: [
          "ISS",
          "ICMS",
          "PIS/COFINS"
        ]
      },
      "4. (+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS": {
        order: 3,
        displayName: "(+) OUTRAS RECEITAS OPERACIONAIS E NÃO OPERACIONAIS",
        items: [
          "Resgate de Aplicação",
          "Empréstimo",
          "Aporte de Sócio"
        ]
      },
      "5. (-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)": {
        order: 4,
        displayName: "(-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)",
        items: [
          "Insumos e ingredientes",
          "Doces",
          "Carnes",
          "Bebidas",
          "Vinho",
          "Chopp",
          "Hortifrúti",
          "Café"
        ]
      },
      "7. (-) DESPESAS OPERACIONAIS": {
        order: 5,
        displayName: "(-) DESPESAS OPERACIONAIS",
        items: [
          "DAS",
          "Contabilidade",
          "Consultoria / Assessoria",
          "Advogado",
          "Segurança",
          "Sistema",
          "Despesa Bancária",
          "Despesa Financeira",
          "Correio / Cartório",
          "Outras Despesas ADM",
          "Aluguel",
          "Condomínio",
          "Energia Elétrica",
          "Gás",
          "Água / Esgoto",
          "Internet",
          "Telefone e TV a Cabo",
          "Estacionamento",
          "Equipamentos",
          "Informática",
          "Predial",
          "Móveis e Utensílios",
          "Dedetização",
          "Propaganda e Publicidade",
          "Serviços Gráficos",
          "Material de Escritório",
          "Embalagem / Descartáveis",
          "Limpeza / Higiene",
          "Materiais de Reposição",
          "Salário",
          "Adiantamento",
          "Free-lance / Taxa",
          "13º Salário",
          "Férias + Abono",
          "Rescisão Contratual",
          "Vale Transporte",
          "Exame Médico",
          "FGTS",
          "Contribuição Sindical",
          "Refeição Funcionário",
          "INSS",
          "Treinamento",
          "Uniforme",
          "Farmácia",
          "Artístico",
          "Outras Despesas RH",
          "Locação de Equipamentos",
          "Aquisição de Equipamentos"
        ]
      },
      "8. (-) DESPESAS COM SÓCIOS": {
        order: 6,
        displayName: "(-) DESPESAS COM SÓCIOS",
        items: [
          "Despesas de Sócios",
          "Pró-labore",
          "Imposto de Renda Pessoa Física"
        ]
      },
      "9. (-) INVESTIMENTOS": {
        order: 7,
        displayName: "(-) INVESTIMENTOS",
        items: [
          "Obras e Instalações",
          "Equipamentos / Aplicações em Fundos"
        ]
      }
    };

    // Se o modelo selecionado for Barbearia/Salão
    if (businessModel === "barbearia") {
      // Remover Ifood e VR da receita
      const receiptItems = baseCategories["1. RECEITA"].items;
      baseCategories["1. RECEITA"].items = receiptItems.filter(
        item => item !== "Ifood" && item !== "VR"
      );
      
      // Substituir itens do CMV por itens específicos para barbearia/salão
      baseCategories["5. (-) CUSTOS DAS MERCADORIAS VENDIDAS (CMV)"].items = [
        "Lâminas",
        "Tinturas",
        "Descolorantes",
        "Shampoos",
        "Espuma de barbear",
        "Loções",
        "Pomadas",
        "Óleos para barba",
        "Esmaltes"
      ];
    }

    return baseCategories;
  };

  // Obter categorias atualizadas com base no modelo de negócio
  const financialCategories = getFinancialCategories();

  // Converter o objeto de categorias em um array para facilitar a navegação
  const categoryGroups = Object.keys(financialCategories);
  // Total de passos agora inclui o modelo de negócio + as categorias
  const totalSteps = businessModel ? categoryGroups.length + 1 : 1;
  
  // Efeito para resetar a posição de rolagem quando mudar de etapa
  useEffect(() => {
    // Rolar para o topo da página
    window.scrollTo(0, 0);
    
    // Também resetar a rolagem do container de categorias se ele tiver uma referência
    const categoriesContainer = document.querySelector('.category-list.single-page');
    if (categoriesContainer) {
      categoriesContainer.scrollTop = 0;
    }
  }, [currentStep]);

  // Efeito para monitorar mudanças na autenticação e carregar dados do usuário
  useEffect(() => {
    setLoading(true);
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        // Carregar categorias previamente selecionadas pelo usuário
        loadUserCategories(currentUser.uid);
      } else {
        navigate("/login");
      }
    });

    return () => unsubscribe();
  }, [navigate]);
  
  // Função para carregar as categorias do usuário do Firestore
  const loadUserCategories = async (userId) => {
    try {
      // Fazer a consulta ao Firestore para obter as categorias do usuário
      const userCategoriesDoc = await getDoc(doc(db, "userCategories", userId));
      
      if (userCategoriesDoc.exists()) {
        const data = userCategoriesDoc.data();
        
        // Importante: Carregar as categorias do Firestore, não do cache
        if (data.categories) {
          console.log("Categorias carregadas do Firestore:", data.categories);
          setSelectedCategories(data.categories);
        }

        // Se o usuário já tem um modelo de negócio salvo, carregá-lo
        if (data.businessModel) {
          setBusinessModel(data.businessModel);
        }
      }
    } catch (error) {
      console.error("Erro ao carregar categorias do usuário:", error);
    } finally {
      setLoading(false);
    }
  };

  // Função para selecionar modelo de negócio
  const handleBusinessModelSelect = (model) => {
    setBusinessModel(model);
    // Resetar categorias selecionadas se mudar o modelo de negócio
    setSelectedCategories({});
    // Avançar para a próxima etapa
    setCurrentStep(1);
  };

  // Função para alternar o estado de seleção de uma categoria
  const handleCategoryToggle = (category) => {
    // Calculamos o índice do grupo adequado porque agora temos a etapa 0 para modelo de negócio
    const categoryIndex = currentStep - 1;
    const currentGroup = categoryGroups[categoryIndex];
    const displayName = financialCategories[currentGroup].displayName;
    
    setSelectedCategories(prev => {
      // Usar o nome sem o prefixo numérico para armazenamento
      const path = `${displayName}.${category}`;
      
      return {
        ...prev,
        [path]: !prev[path]
      };
    });
  };

  // Função para salvar categorias no Firestore
  const saveCategories = async () => {
    if (!user) {
      console.error("Usuário não autenticado");
      alert("Você precisa estar logado para salvar categorias.");
      navigate("/login");
      return;
    }
    
    try {
      setSaving(true);
      
      // Verificar autenticação atual
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("Sessão expirada. Faça login novamente.");
      }
      
      // Preparar os dados para salvar
      const categoriesToSave = {};
      
      // Processar categorias selecionadas
      Object.keys(selectedCategories).forEach(path => {
        if (selectedCategories[path]) {
          categoriesToSave[path] = true;
        }
      });

      // Armazenar metadata para ajudar na ordenação
      const categoryOrderData = {};
      Object.keys(financialCategories).forEach(groupKey => {
        const { displayName, order } = financialCategories[groupKey];
        categoryOrderData[displayName] = order;
      });

      console.log("Salvando categorias para o usuário:", currentUser.uid);
      
      // Salvar no Firestore com o modelo de negócio
      await setDoc(doc(db, "userCategories", currentUser.uid), {
        categories: categoriesToSave,
        categoryOrder: categoryOrderData,
        businessModel: businessModel,
        createdAt: new Date()
      });

      console.log("Categorias salvas com sucesso!");
      
      // Navegar para o dashboard
      navigate("/dashboard");
    } catch (error) {
      console.error("Erro ao salvar categorias:", error);
      
      let errorMessage = "Erro ao salvar suas categorias. Tente novamente.";
      
      if (error.code === "permission-denied") {
        errorMessage = "Permissão negada. Verifique as regras do Firestore.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      alert(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  // Funções de navegação
  const handleNext = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep(prevStep => prevStep + 1);
    } else {
      saveCategories();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(prevStep => prevStep - 1);
    }
  };

  // Função para verificar se uma categoria está selecionada, baseado nos dados do Firebase
  const isCategorySelected = (group, category) => {
    const displayName = financialCategories[group].displayName;
    const path = `${displayName}.${category}`;
    return !!selectedCategories[path];
  };

  if (loading) {
    return (
      <div className="category-selection-container">
        <div className="category-selection-card loading-card">
          <div className="loading-spinner"></div>
          <p>Carregando suas categorias...</p>
        </div>
      </div>
    );
  }

  // Renderizar a seleção de modelo de negócio como etapa 0
  if (currentStep === 0) {
    return (
      <div className="category-selection-container">
        <div className="category-selection-card">
          <div className="progress-bar-container">
            <div className="progress-text">
              Etapa 0 de {totalSteps - 1}
            </div>
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: "0%" }}
              ></div>
            </div>
          </div>
          
          <div className="step-heading">
            <span className="step-number">Etapa 0</span>
            <h2 className="category-group-title">Modelo de Negócio</h2>
          </div>
          
          <p className="instruction">Selecione o tipo de negócio da sua empresa:</p>
          
          <div className="business-model-selection">
            <button 
              className={`business-model-button ${businessModel === 'restaurante' ? 'selected' : ''}`}
              onClick={() => handleBusinessModelSelect('restaurante')}
            >
              <div className="business-icon">🍽️</div>
              <div className="business-type">Restaurante/Bar</div>
            </button>
            
            <button 
              className={`business-model-button ${businessModel === 'barbearia' ? 'selected' : ''}`}
              onClick={() => handleBusinessModelSelect('barbearia')}
            >
              <div className="business-icon">✂️</div>
              <div className="business-type">Barbearia/Salão</div>
            </button>
          </div>
          
          <div className="navigation-buttons">
            <button 
              className="previous-button" 
              onClick={handlePrevious} 
              disabled={true}
            >
              Anterior
            </button>
            
            <button 
              className="next-button" 
              onClick={handleNext}
              disabled={!businessModel}
            >
              Próximo
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Para as etapas de categoria (1 em diante), ajustar o índice para acessar o grupo correto
  const categoryIndex = currentStep - 1;
  const currentGroup = categoryGroups[categoryIndex];
  const currentCategories = financialCategories[currentGroup].items;

  return (
    <div className="category-selection-container">
      <div className="category-selection-card">
        <div className="progress-bar-container">
          <div className="progress-text">
            Etapa {currentStep} de {totalSteps - 1}
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
            ></div>
          </div>
        </div>
        
        <div className="step-heading">
          <span className="step-number">Etapa {currentStep}</span>
          <h2 className="category-group-title">{currentGroup}</h2>
        </div>
        
        <p className="instruction">Selecione as opções que você deseja utilizar:</p>
        
        <div className="categories-container">
          <div className="category-list single-page">
            {currentCategories.map((category, index) => {
              // Para cada categoria, verificamos no estado selectedCategories carregado do Firebase
              const isSelected = isCategorySelected(currentGroup, category);
              return (
                <div key={index} className="category-item">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleCategoryToggle(category)}
                    />
                    {category}
                  </label>
                </div>
              );
            })}
          </div>
        </div>

        <div className="navigation-buttons">
          <button 
            className="previous-button" 
            onClick={handlePrevious} 
            disabled={currentStep === 0}
          >
            Anterior
          </button>
          
          <button 
            className="next-button" 
            onClick={handleNext}
            disabled={saving}
          >
            {currentStep === totalSteps - 1 
              ? (saving ? "Salvando..." : "Finalizar") 
              : "Próximo"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CategorySelection;