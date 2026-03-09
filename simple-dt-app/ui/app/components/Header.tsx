import React from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "@dynatrace/strato-components-preview/layouts";

export const Header = () => {
  return (
    <AppHeader>
      <AppHeader.NavItems>
        <AppHeader.AppNavLink as={Link} to="/" />
        <AppHeader.NavItem as={Link} to="/">
          Portugal Roads
        </AppHeader.NavItem>
        <AppHeader.NavItem as={Link} to="/home">
          Home
        </AppHeader.NavItem>
        <AppHeader.NavItem as={Link} to="/data">
          Explore Data
        </AppHeader.NavItem>
      </AppHeader.NavItems>
    </AppHeader>
  );
};
