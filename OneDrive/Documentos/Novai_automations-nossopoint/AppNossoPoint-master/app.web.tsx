import React from "react";
import ComandaWeb from "./screens/HomeScreen.web"

export default function App() {
  return <ComandaWeb apiBase="http://192.168.15.27:8000" />; // opcional
}