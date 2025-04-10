// src/utils/OFXParser.js

/**
 * Parse the OFX file content to extract transactions
 * @param {string} content - The content of the OFX file
 * @returns {Array} - Array of parsed transactions
 */
export const parseOFXContent = (content) => {
    const transactions = [];
    
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
      const fitidMatch = /<FITID>(.*?)<\/FITID>/i.exec(transactionData);
      
      if (dateMatch && amountMatch) {
        let date = dateMatch[1] || '';
        // Format date from OFX format (YYYYMMDD) to YYYY-MM-DD
        if (date.length >= 8) {
          date = `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}`;
        }
        
        const amount = parseFloat(amountMatch[1] || '0');
        const memo = memoMatch ? memoMatch[1] : '';
        const fitid = fitidMatch ? fitidMatch[1] : `trn-${i}-${Date.now()}`;
        
        transactions.push({
          id: fitid,
          date,
          amount,
          description: memo,
          category: null, // Will be set during categorization
          categoryPath: null, // Full path of the category
          createdAt: new Date()
        });
      }
    }
    
    return transactions;
  };
  
  /**
   * Parse an OFX file from a File object
   * @param {File} file - The OFX file to parse
   * @returns {Promise} - Promise resolving to an array of transactions
   */
  export const parseOFXFile = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (event) => {
        try {
          const content = event.target.result;
          const transactions = parseOFXContent(content);
          resolve(transactions);
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