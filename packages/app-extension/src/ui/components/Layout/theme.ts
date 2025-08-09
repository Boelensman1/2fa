import { createTheme } from '@mui/material/styles'
import { ButtonProps } from '@mui/material/Button'

import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'

declare module '@mui/material/Button' {
  interface ButtonPropsVariantOverrides {
    menu: true
    active: true
  }
}

declare module '@mui/material/styles' {
  interface TypographyVariants {
    tag: React.CSSProperties
  }

  // allow configuration using `createTheme`
  interface TypographyVariantsOptions {
    tag?: React.CSSProperties
  }
}

// Update the Typography's variant prop options
declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    tag: true
  }
}

// not sure if this is possible
interface CustomButtonProps extends ButtonProps {
  menu: boolean
  active?: boolean
}

const headingFont = 'Inter'
const bodyFont = 'Inter'

const theme = createTheme({
  breakpoints: {
    values: {
      xs: 0,
      sm: 600,
      md: 800, //900 original
      lg: 1200,
      xl: 1536,
    },
  },
  palette: {
    secondary: {
      main: '#2F9C89',
    },
    text: {
      primary: '#2E4A4D',
    },
    success: {
      main: '#48BD92',
    },
    error: {
      main: '#F26B6B',
    },
  },
  typography: {
    h1: {
      fontFamily: headingFont,
    },
    h2: {
      fontFamily: headingFont,
    },
    h3: {
      fontFamily: headingFont,
    },
    h4: {
      fontFamily: headingFont,
    },
    h5: {
      fontFamily: headingFont,
      fontWeight: '700',
    },
    h6: {
      fontFamily: headingFont,
    },
    body1: {
      fontFamily: bodyFont,
    },
    body2: {
      fontFamily: bodyFont,
    },
    tag: {
      color: '#2D9D4C',
      textTransform: 'uppercase',
      fontSize: '.8rem',
      fontWeight: '600',
    },

    subtitle1: {
      fontSize: '1.1rem',
      lineHeight: 1.5,
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none', // don't capitalize buttons
          fontWeight: '600',
        },
      },

      variants: [
        {
          props: { variant: 'menu' } as CustomButtonProps,
          style: {
            fontSize: '1.1rem',
            fontWeight: '400',
            justifyContent: 'flex-start',
            padding: '10px 16px', // Custom padding for menu variant
            borderRadius: '8px',
            '&:hover': {
              backgroundColor: 'rgba(0, 0, 0, 0.05)', // Match hover style with active style
            },
          },
        },
        {
          props: { variant: 'menu', active: true } as CustomButtonProps,
          style: {
            backgroundColor: 'rgba(0, 0, 0, 0.05)', // Active button background
          },
        },
      ],
      defaultProps: {
        disableElevation: true,
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: '8px', // Set border radius to 8px
        },
      },
      defaultProps: {
        elevation: 0,
      },
    },
  },
})

export default theme
