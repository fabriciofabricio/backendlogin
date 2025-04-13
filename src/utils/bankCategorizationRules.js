// src/utils/bankCategorizationRules.js

/**
 * Regras de categorização para diferentes bancos
 * Este arquivo contém as regras específicas para categorização automática
 * de transações de diferentes bancos
 */

/**
 * Aplica regras de categorização para o banco SICOOB/COOP
 * @param {Object} transaction - Dados da transação
 * @returns {Object} - Informações de categoria, se aplicável
 */
const categorizeSicoobTransactions = (transaction) => {
  const { description, amount } = transaction;
  
  // Apenas categorizar transações positivas
  if (amount <= 0) return null;
  
  if (description.includes('DEB') || description.includes('DB')) {
    return {
      category: 'Cartão de Débito',
      categoryPath: 'RECEITA.Cartão de Débito',
      autoMapped: true
    };
  } else if (description.includes('ANTEC') || description.includes('Antec') || description.includes('CR')) {
    return {
      category: 'Cartão de Crédito',
      categoryPath: 'RECEITA.Cartão de Crédito',
      autoMapped: true
    };
  } else if (description.includes('PIX')) {
    return {
      category: 'Pix',
      categoryPath: 'RECEITA.Pix',
      autoMapped: true
    };
  } else if (description.includes('TED')) {
    return {
      category: 'TED',
      categoryPath: 'RECEITA.TED',
      autoMapped: true
    };
  } else if (description.includes('IFOOD')) {
    return {
      category: 'Ifood',
      categoryPath: 'RECEITA.Ifood',
      autoMapped: true
    };
  }
  
  return null;
};

/**
 * Aplica regras de categorização para o banco Stone
 * @param {Object} transaction - Dados da transação
 * @returns {Object} - Informações de categoria, se aplicável
 */
const categorizeStoneTransactions = (transaction) => {
  const { description, amount } = transaction;
  
  // Apenas categorizar transações positivas
  if (amount <= 0) return null;
  
  // Nova regra: Verificar se contém "Recebimento vendas - Antecipação"
  if (description.includes('Recebimento vendas - Antecipação')) {
    return {
      category: 'Cartão de Crédito',
      categoryPath: 'RECEITA.Cartão de Crédito',
      autoMapped: true
    };
  }
  // Nova regra: Verificar se contém "ifood" (case insensitive)
  else if (description.toLowerCase().includes('ifood')) {
    return {
      category: 'Ifood',
      categoryPath: 'RECEITA.Ifood',
      autoMapped: true
    };
  }
  // Verifica se termina com "Maquininha"
  else if (description.trim().endsWith('Maquininha')) {
    return {
      category: 'Pix',
      categoryPath: 'RECEITA.Pix',
      autoMapped: true
    };
  }
  // Verifica se contém "Crédito"
  else if (description.includes('Crédito')) {
    return {
      category: 'Cartão de Crédito',
      categoryPath: 'RECEITA.Cartão de Crédito',
      autoMapped: true
    };
  }
  // Verifica se termina com "TED"
  else if (description.trim().endsWith('TED')) {
    return {
      category: 'TED',
      categoryPath: 'RECEITA.TED',
      autoMapped: true
    };
  }
  // Verifica se termina com "Débito"
  else if (description.trim().endsWith('Débito')) {
    return {
      category: 'Cartão de Débito',
      categoryPath: 'RECEITA.Cartão de Débito',
      autoMapped: true
    };
  }
  // Verifica se a primeira palavra é "VR"
  else if (description.trim().split(' ')[0] === 'VR') {
    return {
      category: 'VR',
      categoryPath: 'RECEITA.VR',
      autoMapped: true
    };
  }
  // Verifica se começa com "ALELO"
  else if (description.trim().startsWith('ALELO')) {
    return {
      category: 'VR',
      categoryPath: 'RECEITA.VR',
      autoMapped: true
    };
  }
  
  // Importante: Não categorizar automaticamente padrões "Transferência | Pix"
  
  return null;
};

/**
 * Categoriza uma transação baseado nas regras específicas de cada banco
 * @param {Object} transaction - Dados da transação
 * @param {Object} bankInfo - Informações do banco
 * @returns {Object} - Informações de categoria, ou null se nenhuma regra aplicável
 */
export const categorizeTransaction = (transaction, bankInfo) => {
  if (!bankInfo || !bankInfo.org) return null;
  
  const bankName = bankInfo.org;
  
  // SICOOB/COOP
  if (bankName.includes('COOP DE CRED') || bankName.includes('SICOOB')) {
    return categorizeSicoobTransactions(transaction);
  }
  
  // Stone
  if (bankName.includes('Stone Instituição de Pagamento')) {
    return categorizeStoneTransactions(transaction);
  }
  
  // Adicionar regras para outros bancos aqui
  
  return null;
};