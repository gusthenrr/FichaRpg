import React, { createContext, useState } from 'react';

// Create the User Context
export const UserContext = createContext();

// Create a UserProvider component that wraps the app and provides the user state
export const UserProvider = ({ children }) => {
  const [user, setUser] = useState({ username: '', cargo: '' });

  return (
    <UserContext.Provider value={{ user, setUser }}>
      {children}
    </UserContext.Provider>
  );
};
