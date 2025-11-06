// TokenContext.js
import React, { createContext, useContext, useState } from 'react';

const TokenContext = createContext();

export const TokenProvider = ({ children }) => {
  const [expoPushToken, setExpoPushToken] = useState(null);

  return (
    <TokenContext.Provider value={{ expoPushToken, setExpoPushToken }}>
      {children}
    </TokenContext.Provider>
  );
};

export const useToken = () => useContext(TokenContext);
