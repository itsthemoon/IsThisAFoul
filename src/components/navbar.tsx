"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User, LogOut, Settings } from "lucide-react";
import Image from "next/image";

export function Navbar() {
  // Placeholder state for auth - this will be replaced with actual NextAuth session
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [user, setUser] = useState<{
    name?: string;
    email?: string;
    image?: string;
  } | null>(null);

  // Check for dummy user data on component mount
  useEffect(() => {
    const dummyUser = localStorage.getItem("dummyUser");
    if (dummyUser) {
      try {
        const userData = JSON.parse(dummyUser);
        setUser(userData);
        setIsSignedIn(true);
      } catch (error) {
        console.error("Error parsing dummy user data:", error);
        localStorage.removeItem("dummyUser");
      }
    }
  }, []);

  const handleSignIn = () => {
    // Placeholder sign in - this will be replaced with actual NextAuth signIn
    // Navigate to sign-in page
    window.location.href = "/auth/signin";
  };

  const handleSignOut = () => {
    // Placeholder sign out - this will be replaced with actual NextAuth signOut
    localStorage.removeItem("dummyUser");
    setIsSignedIn(false);
    setUser(null);
  };

  return (
    <nav className="border-b border-gray-800 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center px-4">
        <div className="mr-4 flex">
          <a className="mr-6 flex items-center space-x-2" href="/">
            <Image
              src="/isthisafoullogo.png"
              alt="IsThisAFoul"
              width={120}
              height={40}
              className="h-8 w-auto"
              priority
            />
          </a>
        </div>

        <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
          <div className="w-full flex-1 md:w-auto md:flex-none">
            {/* Future: Add search functionality here */}
          </div>

          <nav className="flex items-center space-x-2">
            {!isSignedIn ? (
              <Button
                onClick={handleSignIn}
                className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105"
              >
                Sign In
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="relative h-8 w-8 rounded-full"
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user?.image} alt={user?.name ?? ""} />
                      <AvatarFallback>
                        {user?.name?.charAt(0)?.toUpperCase() ?? (
                          <User className="h-4 w-4" />
                        )}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <div className="flex items-center justify-start gap-2 p-2">
                    <div className="flex flex-col space-y-1 leading-none">
                      {user?.name && <p className="font-medium">{user.name}</p>}
                      {user?.email && (
                        <p className="w-[200px] truncate text-sm text-muted-foreground">
                          {user.email}
                        </p>
                      )}
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </nav>
        </div>
      </div>
    </nav>
  );
}
