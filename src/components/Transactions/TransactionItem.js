// src/components/Transactions/TransactionItem.js
import React, { useState, useEffect } from "react";

const TransactionItem = ({ 
  transaction, 
  categories, 
  onCategoryChange, 
  isCategorizing
}) => {
  const [selectedCategory, setSelectedCategory] = useState('');
  const [isEditing, setIsEditing] = useState(!transaction.category);
  const [flatCategories, setFlatCategories] = useState([]);

  // Format date for display
  const formattedDate = new Date(transaction.date).toLocaleDateString('pt-BR');
  
  // Format amount for display
  const formattedAmount = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(transaction.amount);

  // Preparar lista simplificada de categorias quando o componente monta ou quando as categorias mudam
  useEffect(() => {
    if (categories) {
      const flattenedCategories = [];
      
      // Para cada grupo principal
      Object.entries(categories).forEach(([groupName, groupData]) => {
        // Adicionar cada item do grupo com seu caminho completo
        if (groupData.items && Array.isArray(groupData.items)) {
          groupData.items.forEach(item => {
            flattenedCategories.push({
              label: item, // O que será mostrado na UI
              value: `${groupName}.${item}`, // O valor completo para o caminho da categoria
              group: groupName
            });
          });
        }
      });
      
      // Ordenar alfabeticamente pelo nome da categoria
      flattenedCategories.sort((a, b) => a.label.localeCompare(b.label));
      
      setFlatCategories(flattenedCategories);
      
      // Se a transação já tiver uma categoria, selecione-a
      if (transaction.categoryPath) {
        setSelectedCategory(transaction.categoryPath);
      }
    }
  }, [categories, transaction.categoryPath]);

  // Handle category selection change
  const handleCategoryChange = (e) => {
    const categoryPath = e.target.value;
    setSelectedCategory(categoryPath);
    
    if (categoryPath) {
      // Encontrar detalhes da categoria selecionada
      const selectedCat = flatCategories.find(cat => cat.value === categoryPath);
      
      if (selectedCat) {
        // Chamar o manipulador do componente pai com as informações
        onCategoryChange(
          transaction.id,
          selectedCat.group,
          selectedCat.label,
          categoryPath
        );
      }
    }
  };

  const toggleEditMode = () => {
    setIsEditing(!isEditing);
  };

  return (
    <div className="transaction-item">
      <div className="transaction-date">
        {formattedDate}
      </div>
      
      <div className="transaction-details">
        <p className="transaction-description" title={transaction.description}>
          {transaction.description}
        </p>
      </div>
      
      <div className={`transaction-amount ${transaction.amount >= 0 ? 'amount-positive' : 'amount-negative'}`}>
        {formattedAmount}
      </div>
      
      <div className="transaction-category">
        {isEditing ? (
          <select 
            className="category-select"
            value={selectedCategory}
            onChange={handleCategoryChange}
            disabled={!isCategorizing}
          >
            <option value="">Selecione uma categoria</option>
            {flatCategories.map((category, index) => (
              <option key={index} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        ) : (
          <>
            <span className="category-badge">
              {transaction.category || "Não categorizado"}
            </span>
            <button 
              className="category-change"
              onClick={toggleEditMode}
              disabled={!isCategorizing}
            >
              Alterar
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default TransactionItem;