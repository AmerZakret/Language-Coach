import React from "react";
import { AuthPage } from "../components/auth/AuthPage";

export const LoginPage: React.FC = () => {
  return <AuthPage initialMode="login" />;
};
