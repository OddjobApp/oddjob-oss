# Contributing to GraphRAG Engine

Thank you for your interest in contributing to GraphRAG Engine! This document provides guidelines and instructions for contributing.

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct.html). By participating, you are expected to uphold this code.

## How to Contribute

### Reporting Bugs

If you find a bug, please create an issue with:
- A clear title and description
- Steps to reproduce
- Expected vs actual behavior
- Your environment (OS, Node version, etc.)

### Suggesting Features

We welcome feature suggestions! Please create an issue with:
- A clear description of the feature
- Use cases and benefits
- Possible implementation approach (if you have ideas)

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass (`npm test`)
6. Update documentation as needed
7. Commit your changes (`git commit -m 'Add amazing feature'`)
8. Push to your fork (`git push origin feature/amazing-feature`)
9. Open a Pull Request

### Development Setup

```bash
# Clone your fork
git clone https://github.com/your-username/graphrag-engine.git
cd graphrag-engine

# Install dependencies
npm install

# Run tests
npm test

# Build the project
npm run build
```

### Coding Standards

- Use TypeScript for all new code
- Follow the existing code style
- Add JSDoc comments for public APIs
- Write tests for new functionality
- Keep functions small and focused
- Use meaningful variable names

### Testing

- All new features must include tests
- Aim for >80% code coverage
- Run the full test suite before submitting PRs

### Documentation

- Update README.md if you change public APIs
- Add JSDoc comments to new functions
- Update CHANGELOG.md with your changes

## Questions?

Feel free to open an issue for questions or join our Discord community.

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
