// src/utils/OFXParser.js

/**
 * Parse the OFX file content to extract transactions and bank information
 * @param {string} content - The content of the OFX file
 * @returns {Object} - Object containing parsed transactions and bank info
 */
export const parseOFXContent = (content) => {
  const transactions = [];
  let bankInfo = {
    org: null,
    fid: null,
    bankId: null,
    acctId: null,
    acctType: null
  };
  
  // Extract bank information
  const orgMatch = /<ORG>(.*?)<\/ORG>/i.exec(content);
  const fidMatch = /<FID>(.*?)<\/FID>/i.exec(content);
  const bankIdMatch = /<BANKID>(.*?)<\/BANKID>/i.exec(content);
  const acctIdMatch = /<ACCTID>(.*?)<\/ACCTID>/i.exec(content);
  const acctTypeMatch = /<ACCTTYPE>(.*?)<\/ACCTTYPE>/i.exec(content);
  
  if (orgMatch) bankInfo.org = orgMatch[1].trim();
  if (fidMatch) bankInfo.fid = fidMatch[1].trim();
  if (bankIdMatch) bankInfo.bankId = bankIdMatch[1].trim();
  if (acctIdMatch) bankInfo.acctId = acctIdMatch[1].trim();
  if (acctTypeMatch) bankInfo.acctType = acctTypeMatch[1].trim();
  
  // Split content by transaction markers
  const transactionBlocks = content.split('<STMTTRN>');
  
  // Skip the first element as it's usually header information
  for (let i = 1; i < transactionBlocks.length; i++) {
    const block = transactionBlocks[i];
    
    // Find end of transaction block
    const endIndex = block.indexOf('</STMTTRN>');
    if (endIndex === -1) continue;
    
    const transactionData = block.substring(0, endIndex);
    
    // Extract relevant fields
    const dateMatch = /<DTPOSTED>(.*?)<\/DTPOSTED>/i.exec(transactionData);
    const amountMatch = /<TRNAMT>(.*?)<\/TRNAMT>/i.exec(transactionData);
    const memoMatch = /<MEMO>(.*?)<\/MEMO>/i.exec(transactionData);
    const nameMatch = /<NAME>(.*?)<\/NAME>/i.exec(transactionData);
    const fitidMatch = /<FITID>(.*?)<\/FITID>/i.exec(transactionData);
    const typeMatch = /<TRNTYPE>(.*?)<\/TRNTYPE>/i.exec(transactionData);
    
    if (dateMatch && amountMatch) {
      let date = dateMatch[1] || '';
      // Format date from OFX format (YYYYMMDD) to YYYY-MM-DD
      if (date.length >= 8) {
        date = `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}`;
      }
      
      const amount = parseFloat(amountMatch[1] || '0');
      const memo = memoMatch ? memoMatch[1] : '';
      const name = nameMatch ? nameMatch[1] : '';
      const fitid = fitidMatch ? fitidMatch[1] : `trn-${i}-${Date.now()}`;
      const trnType = typeMatch ? typeMatch[1] : '';
      
      // Use the name field if available, otherwise fallback to memo
      const description = name || memo;
      
      // Auto-categorize based on bank and transaction description
      let category = null;
      let categoryPath = null;
      let autoMapped = false;
      
      // Apply auto-categorization rules based on bank
      // IMPORTANTE: Apenas aplicar para transações com valor positivo (crédito)
      if (bankInfo.org && amount > 0) {
        // For COOP bank
        if (bankInfo.org.includes('COOP DE CRED') || bankInfo.org.includes('SICOOB')) {
          if (description.includes('DEB') || description.includes('DB')) {
            category = 'Cartão de Débito';
            categoryPath = 'RECEITA.Cartão de Débito';
            autoMapped = true;
          } else if (description.includes('ANTEC') || description.includes('Antec') || description.includes('CR')) {
            category = 'Cartão de Crédito';
            categoryPath = 'RECEITA.Cartão de Crédito';
            autoMapped = true;
          } else if (description.includes('PIX')) {
            category = 'Pix';
            categoryPath = 'RECEITA.Pix';
            autoMapped = true;
          } else if (description.includes('TED')) {
            category = 'TED';
            categoryPath = 'RECEITA.TED';
            autoMapped = true;
          } else if (description.includes('IFOOD')) {
            category = 'Ifood';
            categoryPath = 'RECEITA.Ifood';
            autoMapped = true;
          }
        }
        
        // Additional rules can be added for other banks here
      }
      
      transactions.push({
        id: fitid,
        date,
        amount,
        description,
        name,
        memo,
        trnType,
        category, // Maybe auto-categorized
        categoryPath, // Full path of the category
        autoMapped, // Flag indicating if auto-mapped
        createdAt: new Date(),
        bankInfo: { ...bankInfo } // Include bank info with each transaction
      });
    }
  }
  
  return {
    transactions,
    bankInfo
  };
};

/**
 * Parse an OFX file from a File object
 * @param {File} file - The OFX file to parse
 * @returns {Promise} - Promise resolving to an object with transactions and bank info
 */
export const parseOFXFile = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (event) => {
      try {
        const content = event.target.result;
        const result = parseOFXContent(content);
        resolve(result);
      } catch (error) {
        reject(new Error(`Failed to parse OFX file: ${error.message}`));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Error reading the file'));
    };
    
    reader.readAsText(file);
  });
};